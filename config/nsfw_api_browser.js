/**
 * NSFWFilterAPI — 브라우저 전용 API (V6 GradCAM 완전 호환)
 */

// 판정 기준치 상수
const THRESHOLD_UNSAFE = 0.25;    // 위험 판정 기준
const THRESHOLD_SUSPECT = 0.07;   // 의심 판정 기준
const CONF_HIGH = 0.90;           // High confidence 기준
const CONF_MEDIUM = 0.60;         // Medium confidence 기준

const _WORKER_SRC = `
var CNNJS = {
  zeros: (s) => { 
    if (s.length === 1) return new Float32Array(s[0]); 
    let l = s[0], a = new Array(l), ns = s.slice(1); 
    for (let i = 0; i < l; i++) a[i] = CNNJS.zeros(ns); 
    return a; 
  },
  arrOp: (a, b, fn) => {
    if (Array.isArray(a) || a instanceof Float32Array) {
      let l = a.length, o = Array.isArray(a) ? new Array(l) : new Float32Array(l);
      for (let i = 0; i < l; i++) o[i] = CNNJS.arrOp(a[i], b ? b[i] : null, fn);
      return o;
    }
    return fn(a, b);
  },
  arrScale: (a, s) => {
    if (Array.isArray(a) || a instanceof Float32Array) {
      let l = a.length, o = Array.isArray(a) ? new Array(l) : new Float32Array(l);
      for (let i = 0; i < l; i++) o[i] = CNNJS.arrScale(a[i], s);
      return o;
    }
    return a * s;
  },
  relu: (x) => CNNJS.arrOp(x, null, v => Math.max(0, v)),
  relu_back: (dO, z) => CNNJS.arrOp(dO, z, (d, zv) => zv > 0 ? d : 0),
  sigmoid: (x) => {
    x = Math.max(-500, Math.min(500, x));
    return 1 / (1 + Math.exp(-x));
  },
  sigmoid_3d: (x) => {
    let out = [];
    for (let c = 0; c < x.length; c++) {
      out[c] = [];
      for (let y = 0; y < x[c].length; y++) {
        out[c][y] = new Float32Array(x[c][y].length);
        for (let xi = 0; xi < x[c][y].length; xi++) {
          out[c][y][xi] = CNNJS.sigmoid(x[c][y][xi]);
        }
      }
    }
    return out;
  },
  
  wgap: (F, A) => {
    let C = F.length, H = F[0].length, W = F[0][0].length;
    let sumA = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) sumA += A[0][y][x];
    let denom = sumA + 1e-7;
    let out = new Float32Array(C);
    for (let c = 0; c < C; c++) {
      let s = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) s += F[c][y][x] * A[0][y][x];
      out[c] = s / denom;
    }
    return { out, denom, sumA };
  },
  
  wgap_back: (dO, F, A, fw_w) => {
    let C = F.length, H = F[0].length, W = F[0][0].length;
    let dF = CNNJS.zeros([C, H, W]);
    let denom = fw_w.denom;
    for (let c = 0; c < C; c++) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          dF[c][y][x] = dO[c] * A[0][y][x] / denom;
        }
      }
    }
    return { dF };
  },
  
  depthwise_conv2d: (inArr, Fdw, b) => {
    let C = inArr.length, H = inArr[0].length, W = inArr[0][0].length;
    let kH = Fdw[0][0].length, kW = Fdw[0][0][0].length;
    let oH = H - kH + 1, oW = W - kW + 1, out = [];
    for (let c = 0; c < C; c++) {
      out[c] = [];
      for (let i = 0; i < oH; i++) {
        out[c][i] = new Float32Array(oW);
        for (let j = 0; j < oW; j++) {
          let s = b[c];
          for (let ki = 0; ki < kH; ki++) 
            for (let kj = 0; kj < kW; kj++) 
              s += inArr[c][i + ki][j + kj] * Fdw[c][0][ki][kj];
          out[c][i][j] = s;
        }
      }
    }
    return out;
  },
  
  depthwise_back: (dO, inArr, Fdw) => {
    let C = inArr.length, H = inArr[0].length, W = inArr[0][0].length;
    let kH = Fdw[0][0].length, kW = Fdw[0][0][0].length;
    let oH = dO[0].length, oW = dO[0][0].length;
    let dIn = CNNJS.zeros([C, H, W]), dF = CNNJS.zeros([C, 1, kH, kW]), dB = new Float32Array(C);
    for (let c = 0; c < C; c++) {
      for (let i = 0; i < oH; i++) {
        for (let j = 0; j < oW; j++) {
          let d = dO[c][i][j];
          dB[c] += d;
          for (let ki = 0; ki < kH; ki++) {
            for (let kj = 0; kj < kW; kj++) {
              dF[c][0][ki][kj] += d * inArr[c][i + ki][j + kj];
              dIn[c][i + ki][j + kj] += d * Fdw[c][0][ki][kj];
            }
          }
        }
      }
    }
    return [dIn, dF, dB];
  },
  
  pointwise_conv2d: (inArr, Fpw, b) => {
    let Ci = inArr.length, H = inArr[0].length, W = inArr[0][0].length;
    let Co = Fpw.length, out = [];
    for (let f = 0; f < Co; f++) {
      out[f] = [];
      for (let i = 0; i < H; i++) {
        out[f][i] = new Float32Array(W);
        for (let j = 0; j < W; j++) {
          let s = b[f];
          for (let c = 0; c < Ci; c++) s += inArr[c][i][j] * Fpw[f][c][0][0];
          out[f][i][j] = s;
        }
      }
    }
    return out;
  },
  
  pointwise_back: (dO, inArr, Fpw) => {
    let Ci = inArr.length, H = inArr[0].length, W = inArr[0][0].length;
    let Co = Fpw.length;
    let dIn = CNNJS.zeros([Ci, H, W]), dF = CNNJS.zeros([Co, Ci, 1, 1]), dB = new Float32Array(Co);
    for (let f = 0; f < Co; f++) {
      for (let i = 0; i < H; i++) {
        for (let j = 0; j < W; j++) {
          let d = dO[f][i][j];
          dB[f] += d;
          for (let c = 0; c < Ci; c++) {
            dF[f][c][0][0] += d * inArr[c][i][j];
            dIn[c][i][j] += d * Fpw[f][c][0][0];
          }
        }
      }
    }
    return [dIn, dF, dB];
  },
  
  maxpool: (inArr, ps) => {
    let C = inArr.length, H = inArr[0].length, W = inArr[0][0].length;
    let oH = Math.floor(H / ps), oW = Math.floor(W / ps);
    let out = [], mask = [];
    for (let c = 0; c < C; c++) {
      out[c] = []; mask[c] = [];
      for (let i = 0; i < oH; i++) {
        out[c][i] = new Float32Array(oW);
        mask[c][i] = [];
        for (let j = 0; j < oW; j++) {
          let mv = -99999, mr = -1, mc = -1;
          for (let y = 0; y < ps; y++) {
            for (let x = 0; x < ps; x++) {
              let v = inArr[c][i * ps + y][j * ps + x];
              if (v > mv) { mv = v; mr = i * ps + y; mc = j * ps + x; }
            }
          }
          out[c][i][j] = mv;
          mask[c][i][j] = [mr, mc];
        }
      }
    }
    return [out, mask];
  },
  
  maxpool_back: (dO, mask, orig, ps) => {
    let C = orig.length, H = orig[0].length, W = orig[0][0].length;
    let dIn = CNNJS.zeros([C, H, W]), oH = dO[0].length, oW = dO[0][0].length;
    for (let c = 0; c < C; c++)
      for (let i = 0; i < oH; i++)
        for (let j = 0; j < oW; j++) {
          let m = mask[c][i][j];
          dIn[c][m[0]][m[1]] += dO[c][i][j];
        }
    return dIn;
  },
  
  fc: (x, W, b) => {
    let o = W.length, ni = x.length, out = new Float32Array(o);
    for (let oi = 0; oi < o; oi++) {
      let s = b[oi];
      for (let ii = 0; ii < ni; ii++) s += W[oi][ii] * x[ii];
      out[oi] = s;
    }
    return out;
  },
  
  fc_back: (dO, x, W) => {
    let o = W.length, ni = x.length, dX = new Float32Array(ni);
    let dW = CNNJS.zeros([o, ni]), dB = new Float32Array(dO.length);
    for (let i = 0; i < dO.length; i++) dB[i] = dO[i];
    for (let oi = 0; oi < o; oi++) {
      for (let ii = 0; ii < ni; ii++) {
        dW[oi][ii] = dO[oi] * x[ii];
        dX[ii] += dO[oi] * W[oi][ii];
      }
    }
    return [dX, dW, dB];
  },
  
  gradcam: (p4, grads) => {
    let C = p4.length, H = p4[0].length, W = p4[0][0].length;
    let cam = new Float32Array(H * W);
    for (let c = 0; c < C; c++) {
      let gc = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) gc += Math.max(0, grads[c][y][x]);
      gc /= (H * W);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) cam[y * W + x] += gc * p4[c][y][x];
    }
    let mx = 0;
    for (let j = 0; j < cam.length; j++) {
      cam[j] = Math.max(0, cam[j]);
      if (cam[j] > mx) mx = cam[j];
    }
    if (mx > 0) for (let j = 0; j < cam.length; j++) cam[j] /= mx;
    let hm = [];
    for (let y = 0; y < H; y++) {
      hm[y] = new Float32Array(W);
      for (let x = 0; x < W; x++) hm[y][x] = cam[y * W + x];
    }
    return hm;
  }
};

// ==================== 최대한 예민하게 설정 ====================
const TH_UNSAFE = 0.40;    // 위험 판정: 40% 이상 (기존 0.85 → 0.40)
const TH_SUSPECT = 0.15;   // 의심 판정: 15% 이상 (기존 0.50 → 0.15)
const CF_HIGH = 0.90;      // High confidence: 90% 이상 또는 10% 이하
const CF_MED = 0.60;       // Medium confidence: 60% 이상 또는 40% 이하

function getLabelFromProb(prob) {
  // 최대한 예민하게: 40%만 넘어도 unsafe, 15% 이상은 suspect
  if (prob >= TH_UNSAFE) return 'unsafe';
  if (prob >= TH_SUSPECT) return 'suspect';
  return 'safe';
}

function getConfidenceFromProb(prob) {
  // 예민하게 설정: 극단적이지 않으면 모두 low/medium
  if (prob >= CF_HIGH || prob <= (1 - CF_HIGH)) return 'high';
  if (prob >= CF_MED || prob <= (1 - CF_MED)) return 'medium';
  return 'low';
}

function getPxFromBitmap(bmp) {
  let cvs = new OffscreenCanvas(512, 512);
  let ctx = cvs.getContext('2d');
  ctx.drawImage(bmp, 0, 0, bmp.width, bmp.height, 0, 0, 512, 512);
  let d = ctx.getImageData(0, 0, 512, 512).data;
  let px = CNNJS.zeros([3, 512, 512]);
  let idx = 0;
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      px[0][y][x] = (d[idx] / 255 - 0.5) * 2;
      px[1][y][x] = (d[idx + 1] / 255 - 0.5) * 2;
      px[2][y][x] = (d[idx + 2] / 255 - 0.5) * 2;
      idx += 4;
    }
  }
  return px;
}

function fwd(px, W, b) {
  let z1d = CNNJS.relu(CNNJS.depthwise_conv2d(px, W.c1_dw, b.c1_dw));
  let a1 = CNNJS.relu(CNNJS.pointwise_conv2d(z1d, W.c1_pw, b.c1_pw));
  let [p1, mk1] = CNNJS.maxpool(a1, 4);
  
  let z2d = CNNJS.relu(CNNJS.depthwise_conv2d(p1, W.c2_dw, b.c2_dw));
  let a2 = CNNJS.relu(CNNJS.pointwise_conv2d(z2d, W.c2_pw, b.c2_pw));
  let [p2, mk2] = CNNJS.maxpool(a2, 4);
  
  let z3d = CNNJS.relu(CNNJS.depthwise_conv2d(p2, W.c3_dw, b.c3_dw));
  let a3 = CNNJS.relu(CNNJS.pointwise_conv2d(z3d, W.c3_pw, b.c3_pw));
  let [p3, mk3] = CNNJS.maxpool(a3, 4);
  
  let z4d = CNNJS.relu(CNNJS.depthwise_conv2d(p3, W.c4_dw, b.c4_dw));
  let a4 = CNNJS.relu(CNNJS.pointwise_conv2d(z4d, W.c4_pw, b.c4_pw));
  let [p4, mk4] = CNNJS.maxpool(a4, 2);
  
  let aa1 = CNNJS.relu(CNNJS.pointwise_conv2d(p4, W.a_w1, b.a_w1));
  let za2 = CNNJS.pointwise_conv2d(aa1, W.a_w2, b.a_w2);
  let aa2 = CNNJS.sigmoid_3d(za2);
  
  let wgapRes = CNNJS.wgap(p4, aa2);
  let fl = wgapRes.out;
  
  let zf1 = CNNJS.fc(fl, W.f1, b.f1);
  let af1 = CNNJS.relu(zf1);
  let zf2 = CNNJS.fc(af1, W.f2, b.f2);
  let af2 = CNNJS.relu(zf2);
  let zf3 = CNNJS.fc(af2, W.f3, b.f3);
  let prob = CNNJS.sigmoid(zf3[0]);
  
  return {
    prob, p4, aa2, af2, zf2, af1, zf1, fl, zf3,
    wgapRes, za2, aa1, a4, z4d, p3, mk4, a3, z3d, 
    p2, mk3, a2, z2d, p1, mk2, a1, z1d, mk1, px
  };
}

function bwd(fw, W, b, px, dz) {
  let [daf2, dWf3, dbf3] = CNNJS.fc_back([dz], fw.af2, W.f3);
  let dzf2 = CNNJS.relu_back(daf2, fw.zf2);
  
  let [daf1d, dWf2, dbf2] = CNNJS.fc_back(dzf2, fw.af1, W.f2);
  let daf1 = daf1d;
  let dzf1 = CNNJS.relu_back(daf1, fw.zf1);
  
  let [dfld, dWf1, dbf1] = CNNJS.fc_back(dzf1, fw.fl, W.f1);
  let dfl = dfld;
  
  let wgGrad = CNNJS.wgap_back(dfl, fw.p4, fw.aa2, fw.wgapRes);
  let dp4 = wgGrad.dF;
  
  let da4 = CNNJS.maxpool_back(dp4, fw.mk4, fw.a4, 2);
  let dz4p = CNNJS.relu_back(da4, fw.a4);
  let [da4d, dWc4p, dbc4p] = CNNJS.pointwise_back(dz4p, fw.z4d, W.c4_pw);
  let dz4d = CNNJS.relu_back(da4d, fw.z4d);
  let [dp3, dWc4d, dbc4d] = CNNJS.depthwise_back(dz4d, fw.p3, W.c4_dw);
  
  let da3 = CNNJS.maxpool_back(dp3, fw.mk3, fw.a3, 4);
  let dz3p = CNNJS.relu_back(da3, fw.a3);
  let [da3d, dWc3p, dbc3p] = CNNJS.pointwise_back(dz3p, fw.z3d, W.c3_pw);
  let dz3d = CNNJS.relu_back(da3d, fw.z3d);
  let [dp2, dWc3d, dbc3d] = CNNJS.depthwise_back(dz3d, fw.p2, W.c3_dw);
  
  let da2 = CNNJS.maxpool_back(dp2, fw.mk2, fw.a2, 4);
  let dz2p = CNNJS.relu_back(da2, fw.a2);
  let [da2d, dWc2p, dbc2p] = CNNJS.pointwise_back(dz2p, fw.z2d, W.c2_pw);
  let dz2d = CNNJS.relu_back(da2d, fw.z2d);
  let [dp1, dWc2d, dbc2d] = CNNJS.depthwise_back(dz2d, fw.p1, W.c2_dw);
  
  let da1 = CNNJS.maxpool_back(dp1, fw.mk1, fw.a1, 4);
  let dz1p = CNNJS.relu_back(da1, fw.a1);
  let [da1d, dWc1p, dbc1p] = CNNJS.pointwise_back(dz1p, fw.z1d, W.c1_pw);
  let dz1d = CNNJS.relu_back(da1d, fw.z1d);
  let [, dWc1d, dbc1d] = CNNJS.depthwise_back(dz1d, px, W.c1_dw);
  
  return {
    c1_dw: dWc1d, c1_pw: dWc1p, c2_dw: dWc2d, c2_pw: dWc2p,
    c3_dw: dWc3d, c3_pw: dWc3p, c4_dw: dWc4d, c4_pw: dWc4p,
    a_w1: CNNJS.zeros([16, 128, 1, 1]), a_w2: CNNJS.zeros([1, 16, 1, 1]),
    f1: dWf1, f2: dWf2, f3: dWf3,
    bc1_dw: dbc1d, bc1_pw: dbc1p, bc2_dw: dbc2d, bc2_pw: dbc2p,
    bc3_dw: dbc3d, bc3_pw: dbc3p, bc4_dw: dbc4d, bc4_pw: dbc4p,
    ba_w1: new Float32Array(16), ba_w2: new Float32Array(1),
    bf1: dbf1, bf2: dbf2, bf3: dbf3,
    dp4: dp4
  };
}

function flatSumSq(a) {
  if (a instanceof Float32Array) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * a[i];
    return s;
  }
  if (Array.isArray(a)) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += flatSumSq(a[i]);
    return s;
  }
  return typeof a === 'number' ? a * a : 0;
}

function clipGradNorm(gW, gb, maxNorm) {
  let n2 = 0;
  for (let k in gW) n2 += flatSumSq(gW[k]);
  for (let k in gb) n2 += flatSumSq(gb[k]);
  let n = Math.sqrt(n2);
  if (n > maxNorm) {
    let s = maxNorm / n;
    for (let k in gW) gW[k] = CNNJS.arrScale(gW[k], s);
    for (let k in gb) gb[k] = CNNJS.arrScale(gb[k], s);
  }
}

let WEIGHTS = null, BIASES = null;

self.onmessage = async function(e) {
  let msg = e.data;
  
  if (msg.type === 'init') {
    WEIGHTS = msg.W;
    BIASES = msg.b;
    self.postMessage({ id: msg.id, ok: true });
    return;
  }
  
  if (msg.type === 'predict') {
    try {
      let st = performance.now();
      let px = msg.px || getPxFromBitmap(msg.bmp);
      let fw = fwd(px, WEIGHTS, BIASES);
      let ms = performance.now() - st;
      
      // 최대한 예민하게 판정
      let label = getLabelFromProb(fw.prob);
      let confidence = getConfidenceFromProb(fw.prob);
      
      let out = { 
        id: msg.id, 
        ok: true, 
        prob: fw.prob, 
        label, 
        confidence, 
        ms,
        p4: fw.p4,
        aa2: fw.aa2,
        af2: fw.af2
      };
      
      if (msg.heatmap && fw.p4) {
        let grads = bwd(fw, WEIGHTS, BIASES, px, 1.0);
        let hm = CNNJS.gradcam(fw.p4, grads.dp4);
        out.heatmap = hm;
      }
      
      self.postMessage(out);
    } catch (err) {
      self.postMessage({ id: msg.id, error: err.message, stack: err.stack });
    }
    return;
  }
  
  if (msg.type === 'classify') {
    try {
      let st = performance.now();
      let px = msg.px || getPxFromBitmap(msg.bmp);
      let fw = fwd(px, WEIGHTS, BIASES);
      let ms = performance.now() - st;
      
      let label = getLabelFromProb(fw.prob);
      let confidence = getConfidenceFromProb(fw.prob);
      
      let out = { 
        id: msg.id, 
        ok: true, 
        prob: fw.prob, 
        label, 
        confidence, 
        ms,
        p4: fw.p4,
        aa2: fw.aa2,
        af2: fw.af2
      };
      
      if (msg.heatmap) {
        let grads = bwd(fw, WEIGHTS, BIASES, px, 1.0);
        let hm = CNNJS.gradcam(fw.p4, grads.dp4);
        out.heatmap = hm;
      }
      
      self.postMessage(out);
    } catch (err) {
      self.postMessage({ id: msg.id, error: err.message });
    }
    return;
  }
  
  if (msg.type === 'feedback') {
    try {
      let px = msg.px || getPxFromBitmap(msg.bmp);
      let correctLabel = msg.correctLabel !== undefined ? msg.correctLabel : (msg.correct === 'unsafe' ? 1.0 : 0.0);
      let lr = msg.lr || 0.005;
      let targetProb = correctLabel === 1.0 ? 0.95 : 0.05;
      
      let W = {}, b = {};
      for (let k in WEIGHTS) {
        if (WEIGHTS[k] instanceof Float32Array) {
          W[k] = new Float32Array(WEIGHTS[k]);
        } else if (Array.isArray(WEIGHTS[k])) {
          W[k] = JSON.parse(JSON.stringify(WEIGHTS[k]));
        } else {
          W[k] = WEIGHTS[k];
        }
      }
      for (let k in BIASES) {
        if (BIASES[k] instanceof Float32Array) {
          b[k] = new Float32Array(BIASES[k]);
        } else if (Array.isArray(BIASES[k])) {
          b[k] = JSON.parse(JSON.stringify(BIASES[k]));
        } else {
          b[k] = BIASES[k];
        }
      }
      
      let steps = 0;
      let dWa = null, dBa = null;
      const MAX_STEPS = 100;
      
      while (steps < MAX_STEPS) {
        let fw = fwd(px, W, b);
        let currentLabel = fw.prob > 0.5 ? 1.0 : 0.0;
        
        if (Math.abs(fw.prob - targetProb) < 0.01 || currentLabel === correctLabel) {
          break;
        }
        
        let dz = fw.prob - targetProb;
        let grads = bwd(fw, W, b, px, dz);
        
        let gW = {
          c1_dw: grads.c1_dw, c1_pw: grads.c1_pw, c2_dw: grads.c2_dw, c2_pw: grads.c2_pw,
          c3_dw: grads.c3_dw, c3_pw: grads.c3_pw, c4_dw: grads.c4_dw, c4_pw: grads.c4_pw,
          a_w1: grads.a_w1, a_w2: grads.a_w2, f1: grads.f1, f2: grads.f2, f3: grads.f3
        };
        let gb = {
          c1_dw: grads.bc1_dw, c1_pw: grads.bc1_pw, c2_dw: grads.bc2_dw, c2_pw: grads.bc2_pw,
          c3_dw: grads.bc3_dw, c3_pw: grads.bc3_pw, c4_dw: grads.bc4_dw, c4_pw: grads.bc4_pw,
          a_w1: grads.ba_w1, a_w2: grads.ba_w2, f1: grads.bf1, f2: grads.bf2, f3: grads.bf3
        };
        clipGradNorm(gW, gb, 5.0);
        
        if (!dWa) {
          dWa = {}; dBa = {};
          for (let k in gW) dWa[k] = CNNJS.arrScale(gW[k], -lr);
          for (let k in gb) dBa[k] = CNNJS.arrScale(gb[k], -lr);
        } else {
          for (let k in gW) dWa[k] = CNNJS.arrOp(dWa[k], CNNJS.arrScale(gW[k], -lr), (a, v) => a + v);
          for (let k in gb) dBa[k] = CNNJS.arrOp(dBa[k], CNNJS.arrScale(gb[k], -lr), (a, v) => a + v);
        }
        
        for (let k in W) {
          if (gW[k]) W[k] = CNNJS.arrOp(W[k], gW[k], (w, g) => w - lr * g);
        }
        for (let k in b) {
          if (gb[k]) b[k] = CNNJS.arrOp(b[k], gb[k], (v, g) => v - lr * g);
        }
        
        steps++;
      }
      
      self.postMessage({
        id: msg.id,
        type: 'feedback_done',
        ok: true,
        deltaW: dWa,
        deltaB: dBa,
        steps: steps
      });
    } catch (err) {
      self.postMessage({ id: msg.id, error: err.message, stack: err.stack });
    }
    return;
  }
  
  if (msg.type === 'train_batch') {
    self.postMessage({ id: msg.id, error: 'train_batch not implemented in this version' });
    return;
  }
};
`;

class NSFWFilterAPI {
  constructor(options = {}) {
    this.options = Object.assign({ modelUrl: '?action=get_model' }, options);
    this._workerUrl = URL.createObjectURL(new Blob([_WORKER_SRC], { type: 'application/javascript' }));
    this.worker = null;
    this._pendingMap = new Map();
    this._reqId = 0;
  }

  async load() {
    if (this.worker) return;
    this.worker = new Worker(this._workerUrl);
    
    let res = await fetch(this.options.modelUrl);
    if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
    let data = await res.json();
    
    let W = {}, b = {};
    
    if (data.ok && data.weights && data.biases) {
      W = data.weights;
      b = data.biases;
    } else if (data.model_weights) {
      for (let row of data.model_weights) {
        let name = row.name;
        let valStr = row.data;
        let val;
        
        if (typeof valStr === 'string') {
          try { val = JSON.parse(valStr); } catch(e) { val = valStr; }
        } else { 
          val = valStr; 
        }
        
        if (name.startsWith('b_')) b[name.substring(2)] = val;
        else W[name] = val;
      }
    } else {
      throw new Error("Invalid model payload structure");
    }

    return new Promise((resolve, reject) => {
      const tempId = ++this._reqId;
      this._pendingMap.set(tempId, { resolve, reject });
      
      this.worker.onmessage = (e) => this._handleWorkerMessage(e);
      this.worker.onerror = (err) => reject(err);
      this.worker.postMessage({ type: 'init', id: tempId, W, b });
    });
  }

  _handleWorkerMessage(e) {
    let msg = e.data;
    if (this._pendingMap.has(msg.id)) {
      let p = this._pendingMap.get(msg.id);
      this._pendingMap.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg);
    }
  }

  async classify(pxData, heatmap = false) {
    if (!this.worker) throw new Error("Model not loaded. Call load() first.");
    
    let px;
    let isBitmap = false;
    
    if (pxData instanceof File || pxData instanceof Blob) {
      px = await this._processImageFile(pxData);
    } else if (typeof pxData === 'string') {
      px = await this._processImageUrl(pxData);
    } else if (typeof ImageBitmap !== 'undefined' && pxData instanceof ImageBitmap) {
      isBitmap = true;
      px = pxData;
    } else if (typeof HTMLImageElement !== 'undefined' && pxData instanceof HTMLImageElement) {
      px = this._processImageElement(pxData);
    } else {
      px = pxData;
    }

    return new Promise((resolve, reject) => {
      const id = ++this._reqId;
      this._pendingMap.set(id, { resolve, reject });
      this.worker.postMessage({ 
        type: 'predict', 
        id, 
        [isBitmap ? 'bmp' : 'px']: px, 
        heatmap 
      });
    });
  }

  async classifyWithHeatmap(pxData) {
    return this.classify(pxData, true);
  }

  async feedback(pxData, correctLabel, lr = 0.005) {
    if (!this.worker) throw new Error("Model not loaded");
    
    let px;
    let isBitmap = false;
    
    if (pxData instanceof File || pxData instanceof Blob) {
      px = await this._processImageFile(pxData);
    } else if (typeof ImageBitmap !== 'undefined' && pxData instanceof ImageBitmap) {
      isBitmap = true;
      px = pxData;
    } else if (typeof HTMLImageElement !== 'undefined' && pxData instanceof HTMLImageElement) {
      px = this._processImageElement(pxData);
    } else {
      px = pxData;
    }

    return new Promise((resolve, reject) => {
      const id = ++this._reqId;
      this._pendingMap.set(id, { resolve, reject });
      this.worker.postMessage({
        type: 'feedback',
        id,
        [isBitmap ? 'bmp' : 'px']: px,
        correct: correctLabel,
        correctLabel: correctLabel === 'unsafe' ? 1.0 : 0.0,
        lr
      });
    });
  }

  async _processImageFile(file) {
    let url = URL.createObjectURL(file);
    try { return await this._processImageUrl(url); } 
    finally { URL.revokeObjectURL(url); }
  }

  async _processImageUrl(url) {
    return new Promise((resolve, reject) => {
      let img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(this._processImageElement(img));
      img.onerror = reject;
      img.src = url;
    });
  }

  _processImageElement(img) {
    let canvas = document.createElement('canvas');
    let ctx = canvas.getContext('2d');
    let size = Math.min(img.width, img.height);
    
    canvas.width = 512;
    canvas.height = 512;
    
    let sx = (img.width - size) / 2;
    let sy = (img.height - size) / 2;
    ctx.drawImage(img, sx, sy, size, size, 0, 0, 512, 512);
    
    let imgData = ctx.getImageData(0, 0, 512, 512).data;
    let px = [[], [], []];
    for (let y = 0; y < 512; y++) {
      px[0][y] = new Float32Array(512);
      px[1][y] = new Float32Array(512);
      px[2][y] = new Float32Array(512);
      for (let x = 0; x < 512; x++) {
        let idx = (y * 512 + x) * 4;
        px[0][y][x] = (imgData[idx] / 255.0) * 2.0 - 1.0;
        px[1][y][x] = (imgData[idx+1] / 255.0) * 2.0 - 1.0;
        px[2][y][x] = (imgData[idx+2] / 255.0) * 2.0 - 1.0;
      }
    }
    return px;
  }

  destroy() {
    if (this.worker) { this.worker.terminate(); this.worker = null; }
    if (this._workerUrl) { URL.revokeObjectURL(this._workerUrl); this._workerUrl = null; }
    this._pendingMap.clear();
  }
}

export default NSFWFilterAPI;

if (typeof window !== 'undefined') {
  window.NSFWFilterAPI = NSFWFilterAPI;
}
