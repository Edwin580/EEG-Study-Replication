// GEE for one binary predictor, ported from the C code in the R package gee
// (Carey, ugee.c, version 4.13) with its default settings: exchangeable
// working correlation, v4.4compat = FALSE, tol = 0.001, maxiter = 25.
//
// With a single 0/1 predictor every quantity the algorithm needs from a
// cluster can be written in terms of three numbers per level: the number of
// observations n, their sum s and their sum of squares q. That is what lets
// the page refit the model for any time window without shipping every trial.
//
// A cluster is { g0: {n, s, q}, g1: {n, s, q} }. Level 0 is the reference,
// so beta[1] is the level 1 minus level 0 difference.

const FAMILIES = {
  gaussian: {
    init(p0, p1) { return [p0, p1 - p0]; },
    // mean, and the standardised derivative a = dmu/deta / sqrt(V(mu))
    at(eta) { return { mu: eta, a: 1 }; },
  },
  binomial: {
    init(p0, p1) { return [logit(p0), logit(p1) - logit(p0)]; },
    at(eta) {
      const mu = 1 / (1 + Math.exp(-eta));
      if (mu >= 0.9999 || mu <= 0.0001) throw new Error("fitted probability too close to 0 or 1");
      return { mu, a: Math.sqrt(mu * (1 - mu)) };
    },
  },
};

function logit(p) { return Math.log(p / (1 - p)); }

// Pearson residual summaries for one level of one cluster.
// For binomial data q equals s, since y is 0 or 1.
function levelTerms(g, x, beta, fam) {
  const { mu, a } = fam.at(beta[0] + beta[1] * x);
  return {
    n: g.n,
    d: [a, a * x],                                         // standardised D row
    e: (g.s - g.n * mu) / a,                               // sum of residuals
    ss: (g.q - 2 * mu * g.s + g.n * mu * mu) / (a * a),    // sum of squared residuals
  };
}

function clusterTerms(c, beta, fam) {
  return [levelTerms(c.g0, 0, beta, fam), levelTerms(c.g1, 1, beta, fam)].filter((t) => t.n > 0);
}

// Contribution of one cluster to D'R^-1 D and D'R^-1 e under an exchangeable
// R with correlation alpha. R^-1 = (I - c J) / (1 - alpha).
function clusterScore(terms, alpha) {
  const ni = terms.reduce((acc, t) => acc + t.n, 0);
  const c = alpha / (1 + (ni - 1) * alpha);
  const k = 1 / (1 - alpha);
  const sd = [0, 0];
  let se = 0;
  const H = [[0, 0], [0, 0]];
  const u = [0, 0];
  for (const t of terms) {
    sd[0] += t.n * t.d[0]; sd[1] += t.n * t.d[1];
    se += t.e;
    for (let r = 0; r < 2; r++) {
      u[r] += t.d[r] * t.e;
      for (let s = 0; s < 2; s++) H[r][s] += t.n * t.d[r] * t.d[s];
    }
  }
  for (let r = 0; r < 2; r++) {
    u[r] = k * (u[r] - c * sd[r] * se);
    for (let s = 0; s < 2; s++) H[r][s] = k * (H[r][s] - c * sd[r] * sd[s]);
  }
  return { H, u };
}

function inv2(m) {
  const det = m[0][0] * m[1][1] - m[0][1] * m[1][0];
  return [[m[1][1] / det, -m[0][1] / det], [-m[1][0] / det, m[0][0] / det]];
}

function mul2(a, b) {
  return [
    [a[0][0] * b[0][0] + a[0][1] * b[1][0], a[0][0] * b[0][1] + a[0][1] * b[1][1]],
    [a[1][0] * b[0][0] + a[1][1] * b[1][0], a[1][0] * b[0][1] + a[1][1] * b[1][1]],
  ];
}

/**
 * Fit the GEE.
 * options.trialClusters: treat every observation as its own cluster. This is
 * what gee() does when a cluster's rows are not next to each other, and it is
 * the bug in the original analysis.
 */
export function gee(clusters, family = "gaussian", options = {}) {
  const { tol = 0.001, maxiter = 25, trialClusters = false } = options;
  const fam = FAMILIES[family];
  const p = 2;
  let N = 0, n0 = 0, s0 = 0, n1 = 0, s1 = 0;
  for (const c of clusters) {
    n0 += c.g0.n; s0 += c.g0.s; n1 += c.g1.n; s1 += c.g1.s;
  }
  N = n0 + n1;
  // gee() starts from the glm fit. With one binary predictor that is the
  // two pooled level means.
  let beta = fam.init(s0 / n0, s1 / n1);
  let alpha = 0, phi = 0, iter = 0, betaOld;

  do {
    betaOld = beta;
    const all = clusters.map((c) => clusterTerms(c, beta, fam));
    let ss = 0, cross = 0, exdiv = 0;
    for (const terms of all) {
      const ni = terms.reduce((acc, t) => acc + t.n, 0);
      const e = terms.reduce((acc, t) => acc + t.e, 0);
      const sq = terms.reduce((acc, t) => acc + t.ss, 0);
      ss += sq;
      if (!trialClusters && ni > 1) {
        cross += e * e - sq;           // sum over j != k of e_j e_k
        exdiv += ni * (ni - 1);
      }
    }
    phi = ss / (N - p);
    alpha = trialClusters ? 0 : cross / (phi * (exdiv - 2 * p));

    const H = [[0, 0], [0, 0]];
    const U = [0, 0];
    for (const terms of all) {
      const { H: h, u } = trialClusters ? clusterScore(terms, 0) : clusterScore(terms, alpha);
      for (let r = 0; r < 2; r++) {
        U[r] += u[r];
        for (let s = 0; s < 2; s++) H[r][s] += h[r][s];
      }
    }
    const Hi = inv2(H);
    beta = [
      beta[0] + Hi[0][0] * U[0] + Hi[0][1] * U[1],
      beta[1] + Hi[1][0] * U[0] + Hi[1][1] * U[1],
    ];
    iter++;
  } while (Math.max(Math.abs(betaOld[0] / beta[0] - 1), Math.abs(betaOld[1] / beta[1] - 1)) > tol
           && iter < maxiter);

  // Sandwich variance at the final beta, using the last working correlation
  const H = [[0, 0], [0, 0]];
  const B = [[0, 0], [0, 0]];
  let ss = 0;
  for (const c of clusters) {
    const terms = clusterTerms(c, beta, fam);
    for (const t of terms) ss += t.ss;
    if (trialClusters) {
      // one cluster per observation: u = d * e for each, so sum u u' = d d' * ss
      for (const t of terms) {
        for (let r = 0; r < 2; r++) {
          for (let s = 0; s < 2; s++) {
            H[r][s] += t.n * t.d[r] * t.d[s];
            B[r][s] += t.d[r] * t.d[s] * t.ss;
          }
        }
      }
    } else {
      const { H: h, u } = clusterScore(terms, alpha);
      for (let r = 0; r < 2; r++) {
        for (let s = 0; s < 2; s++) { H[r][s] += h[r][s]; B[r][s] += u[r] * u[s]; }
      }
    }
  }
  const Hi = inv2(H);
  const robust = mul2(mul2(Hi, B), Hi);
  const se = Math.sqrt(robust[1][1]);
  const z = beta[1] / se;
  return {
    beta, estimate: beta[1], se, z, p: twoSidedP(z),
    alpha, phi: ss / (N - p), iterations: iter,
    clusters: trialClusters ? N : clusters.length, observations: N,
  };
}

// Complementary error function. Power series below 3, continued fraction above.
export function erfc(x) {
  if (x < 0) return 2 - erfc(-x);
  if (x < 3) {
    let term = x, sum = x;
    for (let n = 1; n < 200; n++) {
      term *= -x * x / n;
      const add = term / (2 * n + 1);
      sum += add;
      if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
    }
    return 1 - (2 / Math.sqrt(Math.PI)) * sum;
  }
  // Lentz's method for erfc(x) = exp(-x^2)/sqrt(pi) * 1/(x + (1/2)/(x + 1/(x + (3/2)/(x + ...))))
  const tiny = 1e-300;
  let f = x, C = x, D = 0;
  for (let k = 1; k < 500; k++) {
    const a = k / 2;
    D = x + a * D; D = Math.abs(D) < tiny ? tiny : D; D = 1 / D;
    C = x + a / C; C = Math.abs(C) < tiny ? tiny : C;
    const delta = C * D;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-x * x) / Math.sqrt(Math.PI) / f;
}

export function twoSidedP(z) {
  return erfc(Math.abs(z) / Math.SQRT2);
}
