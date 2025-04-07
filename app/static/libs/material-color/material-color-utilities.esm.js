/**
 * Bundled by jsDelivr using Rollup v2.79.2 and Terser v5.39.0.
 * Original file: /npm/@material/material-color-utilities@0.3.0/index.js
 *
 * Do NOT use SRI with dynamically generated files! More information: https://www.jsdelivr.com/using-sri-with-dynamic-files
 */
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
function t(t) { return t < 0 ? -1 : 0 === t ? 0 : 1 } function e(t, e, r) { return (1 - r) * t + r * e } function r(t, e, r) { return r < t ? t : r > e ? e : r } function n(t, e, r) { return r < t ? t : r > e ? e : r } function a(t) { return (t %= 360) < 0 && (t += 360), t } function o(t) { return (t %= 360) < 0 && (t += 360), t } function i(t, e) { return o(e - t) <= 180 ? 1 : -1 } function s(t, e) { return 180 - Math.abs(Math.abs(t - e) - 180) } function c(t, e) { return [t[0] * e[0][0] + t[1] * e[0][1] + t[2] * e[0][2], t[0] * e[1][0] + t[1] * e[1][1] + t[2] * e[1][2], t[0] * e[2][0] + t[1] * e[2][1] + t[2] * e[2][2]] }
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const h = [[.41233895, .35762064, .18051042], [.2126, .7152, .0722], [.01932141, .11916382, .95034478]], u = [[3.2413774792388685, -1.5376652402851851, -.49885366846268053], [-.9691452513005321, 1.8758853451067872, .04156585616912061], [.05562093689691305, -.20395524564742123, 1.0571799111220335]], l = [95.047, 100, 108.883]; function m(t, e, r) { return (255 << 24 | (255 & t) << 16 | (255 & e) << 8 | 255 & r) >>> 0 } function g(t) { return m(T(t[0]), T(t[1]), T(t[2])) } function d(t) { return t >> 24 & 255 } function f(t) { return t >> 16 & 255 } function y(t) { return t >> 8 & 255 } function p(t) { return 255 & t } function C(t) { return d(t) >= 255 } function P(t, e, r) { const n = u, a = n[0][0] * t + n[0][1] * e + n[0][2] * r, o = n[1][0] * t + n[1][1] * e + n[1][2] * r, i = n[2][0] * t + n[2][1] * e + n[2][2] * r; return m(T(a), T(o), T(i)) } function b(t) { return c([v(f(t)), v(y(t)), v(p(t))], h) } function w(t, e, r) { const n = l, a = (t + 16) / 116, o = a - r / 200, i = F(e / 500 + a), s = F(a), c = F(o); return P(i * n[0], s * n[1], c * n[2]) } function A(t) { const e = v(f(t)), r = v(y(t)), n = v(p(t)), a = h, o = a[0][0] * e + a[0][1] * r + a[0][2] * n, i = a[1][0] * e + a[1][1] * r + a[1][2] * n, s = a[2][0] * e + a[2][1] * r + a[2][2] * n, c = i / l[1], u = s / l[2], m = _(o / l[0]), g = _(c); return [116 * g - 16, 500 * (m - g), 200 * (g - _(u))] } function M(t) { const e = T(x(t)); return m(e, e, e) } function k(t) { return 116 * _(b(t)[1] / 100) - 16 } function x(t) { return 100 * F((t + 16) / 116) } function I(t) { return 116 * _(t / 100) - 16 } function v(t) { const e = t / 255; return e <= .040449936 ? e / 12.92 * 100 : 100 * Math.pow((e + .055) / 1.055, 2.4) } function T(t) { const e = t / 100; let n = 0; return n = e <= .0031308 ? 12.92 * e : 1.055 * Math.pow(e, 1 / 2.4) - .055, r(0, 255, Math.round(255 * n)) } function D() { return l } function S(t) { return { r: f(t), g: y(t), b: p(t), a: d(t) } } function B({ r: t, g: e, b: r, a: n }) { const a = H(t), o = H(e), i = H(r); return H(n) << 24 | a << 16 | o << 8 | i } function H(t) { return t < 0 ? 0 : t > 255 ? 255 : t } function _(t) { const e = 24389 / 27; return t > 216 / 24389 ? Math.pow(t, 1 / 3) : (e * t + 16) / 116 } function F(t) { const e = t * t * t; return e > 216 / 24389 ? e : (116 * t - 16) / (24389 / 27) }
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class O { static make(t = D(), r = 200 / Math.PI * x(50) / 100, n = 50, a = 2, o = !1) { const i = t, s = .401288 * i[0] + .650173 * i[1] + -.051461 * i[2], c = -.250268 * i[0] + 1.204414 * i[1] + .045854 * i[2], h = -.002079 * i[0] + .048952 * i[1] + .953127 * i[2], u = .8 + a / 10, l = u >= .9 ? e(.59, .69, 10 * (u - .9)) : e(.525, .59, 10 * (u - .8)); let m = o ? 1 : u * (1 - 1 / 3.6 * Math.exp((-r - 42) / 92)); m = m > 1 ? 1 : m < 0 ? 0 : m; const g = u, d = [m * (100 / s) + 1 - m, m * (100 / c) + 1 - m, m * (100 / h) + 1 - m], f = 1 / (5 * r + 1), y = f * f * f * f, p = 1 - y, C = y * r + .1 * p * p * Math.cbrt(5 * r), P = x(n) / t[1], b = 1.48 + Math.sqrt(P), w = .725 / Math.pow(P, .2), A = w, M = [Math.pow(C * d[0] * s / 100, .42), Math.pow(C * d[1] * c / 100, .42), Math.pow(C * d[2] * h / 100, .42)], k = [400 * M[0] / (M[0] + 27.13), 400 * M[1] / (M[1] + 27.13), 400 * M[2] / (M[2] + 27.13)]; return new O(P, (2 * k[0] + k[1] + .05 * k[2]) * w, w, A, l, g, d, C, Math.pow(C, .25), b) } constructor(t, e, r, n, a, o, i, s, c, h) { this.n = t, this.aw = e, this.nbb = r, this.ncb = n, this.c = a, this.nc = o, this.rgbD = i, this.fl = s, this.fLRoot = c, this.z = h } } O.DEFAULT = O.make();
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
class R { constructor(t, e, r, n, a, o, i, s, c) { this.hue = t, this.chroma = e, this.j = r, this.q = n, this.m = a, this.s = o, this.jstar = i, this.astar = s, this.bstar = c } distance(t) { const e = this.jstar - t.jstar, r = this.astar - t.astar, n = this.bstar - t.bstar, a = Math.sqrt(e * e + r * r + n * n); return 1.41 * Math.pow(a, .63) } static fromInt(t) { return R.fromIntInViewingConditions(t, O.DEFAULT) } static fromIntInViewingConditions(e, r) { const n = (65280 & e) >> 8, a = 255 & e, o = v((16711680 & e) >> 16), i = v(n), s = v(a), c = .41233895 * o + .35762064 * i + .18051042 * s, h = .2126 * o + .7152 * i + .0722 * s, u = .01932141 * o + .11916382 * i + .95034478 * s, l = .401288 * c + .650173 * h - .051461 * u, m = -.250268 * c + 1.204414 * h + .045854 * u, g = -.002079 * c + .048952 * h + .953127 * u, d = r.rgbD[0] * l, f = r.rgbD[1] * m, y = r.rgbD[2] * g, p = Math.pow(r.fl * Math.abs(d) / 100, .42), C = Math.pow(r.fl * Math.abs(f) / 100, .42), P = Math.pow(r.fl * Math.abs(y) / 100, .42), b = 400 * t(d) * p / (p + 27.13), w = 400 * t(f) * C / (C + 27.13), A = 400 * t(y) * P / (P + 27.13), M = (11 * b + -12 * w + A) / 11, k = (b + w - 2 * A) / 9, x = (20 * b + 20 * w + 21 * A) / 20, I = (40 * b + 20 * w + A) / 20, T = 180 * Math.atan2(k, M) / Math.PI, D = T < 0 ? T + 360 : T >= 360 ? T - 360 : T, S = D * Math.PI / 180, B = I * r.nbb, H = 100 * Math.pow(B / r.aw, r.c * r.z), _ = 4 / r.c * Math.sqrt(H / 100) * (r.aw + 4) * r.fLRoot, F = D < 20.14 ? D + 360 : D, O = 5e4 / 13 * (.25 * (Math.cos(F * Math.PI / 180 + 2) + 3.8)) * r.nc * r.ncb * Math.sqrt(M * M + k * k) / (x + .305), L = Math.pow(O, .9) * Math.pow(1.64 - Math.pow(.29, r.n), .73), V = L * Math.sqrt(H / 100), E = V * r.fLRoot, N = 50 * Math.sqrt(L * r.c / (r.aw + 4)), z = (1 + 100 * .007) * H / (1 + .007 * H), q = 1 / .0228 * Math.log(1 + .0228 * E), G = q * Math.cos(S), U = q * Math.sin(S); return new R(D, V, H, _, E, N, z, G, U) } static fromJch(t, e, r) { return R.fromJchInViewingConditions(t, e, r, O.DEFAULT) } static fromJchInViewingConditions(t, e, r, n) { const a = 4 / n.c * Math.sqrt(t / 100) * (n.aw + 4) * n.fLRoot, o = e * n.fLRoot, i = e / Math.sqrt(t / 100), s = 50 * Math.sqrt(i * n.c / (n.aw + 4)), c = r * Math.PI / 180, h = (1 + 100 * .007) * t / (1 + .007 * t), u = 1 / .0228 * Math.log(1 + .0228 * o), l = u * Math.cos(c), m = u * Math.sin(c); return new R(r, e, t, a, o, s, h, l, m) } static fromUcs(t, e, r) { return R.fromUcsInViewingConditions(t, e, r, O.DEFAULT) } static fromUcsInViewingConditions(t, e, r, n) { const a = e, o = r, i = Math.sqrt(a * a + o * o), s = (Math.exp(.0228 * i) - 1) / .0228 / n.fLRoot; let c = Math.atan2(o, a) * (180 / Math.PI); c < 0 && (c += 360); const h = t / (1 - .007 * (t - 100)); return R.fromJchInViewingConditions(h, s, c, n) } toInt() { return this.viewed(O.DEFAULT) } viewed(e) { const r = 0 === this.chroma || 0 === this.j ? 0 : this.chroma / Math.sqrt(this.j / 100), n = Math.pow(r / Math.pow(1.64 - Math.pow(.29, e.n), .73), 1 / .9), a = this.hue * Math.PI / 180, o = .25 * (Math.cos(a + 2) + 3.8), i = e.aw * Math.pow(this.j / 100, 1 / e.c / e.z), s = o * (5e4 / 13) * e.nc * e.ncb, c = i / e.nbb, h = Math.sin(a), u = Math.cos(a), l = 23 * (c + .305) * n / (23 * s + 11 * n * u + 108 * n * h), m = l * u, g = l * h, d = (460 * c + 451 * m + 288 * g) / 1403, f = (460 * c - 891 * m - 261 * g) / 1403, y = (460 * c - 220 * m - 6300 * g) / 1403, p = Math.max(0, 27.13 * Math.abs(d) / (400 - Math.abs(d))), C = t(d) * (100 / e.fl) * Math.pow(p, 1 / .42), b = Math.max(0, 27.13 * Math.abs(f) / (400 - Math.abs(f))), w = t(f) * (100 / e.fl) * Math.pow(b, 1 / .42), A = Math.max(0, 27.13 * Math.abs(y) / (400 - Math.abs(y))), M = t(y) * (100 / e.fl) * Math.pow(A, 1 / .42), k = C / e.rgbD[0], x = w / e.rgbD[1], I = M / e.rgbD[2]; return P(1.86206786 * k - 1.01125463 * x + .14918677 * I, .38752654 * k + .62144744 * x - .00897398 * I, -.0158415 * k - .03412294 * x + 1.04996444 * I) } static fromXyzInViewingConditions(e, r, n, a) { const o = .401288 * e + .650173 * r - .051461 * n, i = -.250268 * e + 1.204414 * r + .045854 * n, s = -.002079 * e + .048952 * r + .953127 * n, c = a.rgbD[0] * o, h = a.rgbD[1] * i, u = a.rgbD[2] * s, l = Math.pow(a.fl * Math.abs(c) / 100, .42), m = Math.pow(a.fl * Math.abs(h) / 100, .42), g = Math.pow(a.fl * Math.abs(u) / 100, .42), d = 400 * t(c) * l / (l + 27.13), f = 400 * t(h) * m / (m + 27.13), y = 400 * t(u) * g / (g + 27.13), p = (11 * d + -12 * f + y) / 11, C = (d + f - 2 * y) / 9, P = (20 * d + 20 * f + 21 * y) / 20, b = (40 * d + 20 * f + y) / 20, w = 180 * Math.atan2(C, p) / Math.PI, A = w < 0 ? w + 360 : w >= 360 ? w - 360 : w, M = A * Math.PI / 180, k = b * a.nbb, x = 100 * Math.pow(k / a.aw, a.c * a.z), I = 4 / a.c * Math.sqrt(x / 100) * (a.aw + 4) * a.fLRoot, v = A < 20.14 ? A + 360 : A, T = 5e4 / 13 * (1 / 4 * (Math.cos(v * Math.PI / 180 + 2) + 3.8)) * a.nc * a.ncb * Math.sqrt(p * p + C * C) / (P + .305), D = Math.pow(T, .9) * Math.pow(1.64 - Math.pow(.29, a.n), .73), S = D * Math.sqrt(x / 100), B = S * a.fLRoot, H = 50 * Math.sqrt(D * a.c / (a.aw + 4)), _ = (1 + 100 * .007) * x / (1 + .007 * x), F = Math.log(1 + .0228 * B) / .0228, O = F * Math.cos(M), L = F * Math.sin(M); return new R(A, S, x, I, B, H, _, O, L) } xyzInViewingConditions(e) { const r = 0 === this.chroma || 0 === this.j ? 0 : this.chroma / Math.sqrt(this.j / 100), n = Math.pow(r / Math.pow(1.64 - Math.pow(.29, e.n), .73), 1 / .9), a = this.hue * Math.PI / 180, o = .25 * (Math.cos(a + 2) + 3.8), i = e.aw * Math.pow(this.j / 100, 1 / e.c / e.z), s = o * (5e4 / 13) * e.nc * e.ncb, c = i / e.nbb, h = Math.sin(a), u = Math.cos(a), l = 23 * (c + .305) * n / (23 * s + 11 * n * u + 108 * n * h), m = l * u, g = l * h, d = (460 * c + 451 * m + 288 * g) / 1403, f = (460 * c - 891 * m - 261 * g) / 1403, y = (460 * c - 220 * m - 6300 * g) / 1403, p = Math.max(0, 27.13 * Math.abs(d) / (400 - Math.abs(d))), C = t(d) * (100 / e.fl) * Math.pow(p, 1 / .42), P = Math.max(0, 27.13 * Math.abs(f) / (400 - Math.abs(f))), b = t(f) * (100 / e.fl) * Math.pow(P, 1 / .42), w = Math.max(0, 27.13 * Math.abs(y) / (400 - Math.abs(y))), A = t(y) * (100 / e.fl) * Math.pow(w, 1 / .42), M = C / e.rgbD[0], k = b / e.rgbD[1], x = A / e.rgbD[2]; return [1.86206786 * M - 1.01125463 * k + .14918677 * x, .38752654 * M + .62144744 * k - .00897398 * x, -.0158415 * M - .03412294 * k + 1.04996444 * x] } }
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class L { static sanitizeRadians(t) { return (t + 8 * Math.PI) % (2 * Math.PI) } static trueDelinearized(t) { const e = t / 100; let r = 0; return r = e <= .0031308 ? 12.92 * e : 1.055 * Math.pow(e, 1 / 2.4) - .055, 255 * r } static chromaticAdaptation(e) { const r = Math.pow(Math.abs(e), .42); return 400 * t(e) * r / (r + 27.13) } static hueOf(t) { const e = c(t, L.SCALED_DISCOUNT_FROM_LINRGB), r = L.chromaticAdaptation(e[0]), n = L.chromaticAdaptation(e[1]), a = L.chromaticAdaptation(e[2]), o = (11 * r + -12 * n + a) / 11, i = (r + n - 2 * a) / 9; return Math.atan2(i, o) } static areInCyclicOrder(t, e, r) { return L.sanitizeRadians(e - t) < L.sanitizeRadians(r - t) } static intercept(t, e, r) { return (e - t) / (r - t) } static lerpPoint(t, e, r) { return [t[0] + (r[0] - t[0]) * e, t[1] + (r[1] - t[1]) * e, t[2] + (r[2] - t[2]) * e] } static setCoordinate(t, e, r, n) { const a = L.intercept(t[n], e, r[n]); return L.lerpPoint(t, a, r) } static isBounded(t) { return 0 <= t && t <= 100 } static nthVertex(t, e) { const r = L.Y_FROM_LINRGB[0], n = L.Y_FROM_LINRGB[1], a = L.Y_FROM_LINRGB[2], o = e % 4 <= 1 ? 0 : 100, i = e % 2 == 0 ? 0 : 100; if (e < 4) { const e = o, s = i, c = (t - e * n - s * a) / r; return L.isBounded(c) ? [c, e, s] : [-1, -1, -1] } if (e < 8) { const e = o, s = i, c = (t - s * r - e * a) / n; return L.isBounded(c) ? [s, c, e] : [-1, -1, -1] } { const e = o, s = i, c = (t - e * r - s * n) / a; return L.isBounded(c) ? [e, s, c] : [-1, -1, -1] } } static bisectToSegment(t, e) { let r = [-1, -1, -1], n = r, a = 0, o = 0, i = !1, s = !0; for (let c = 0; c < 12; c++) { const h = L.nthVertex(t, c); if (h[0] < 0) continue; const u = L.hueOf(h); i ? (s || L.areInCyclicOrder(a, u, o)) && (s = !1, L.areInCyclicOrder(a, e, u) ? (n = h, o = u) : (r = h, a = u)) : (r = h, n = h, a = u, o = u, i = !0) } return [r, n] } static midpoint(t, e) { return [(t[0] + e[0]) / 2, (t[1] + e[1]) / 2, (t[2] + e[2]) / 2] } static criticalPlaneBelow(t) { return Math.floor(t - .5) } static criticalPlaneAbove(t) { return Math.ceil(t - .5) } static bisectToLimit(t, e) { const r = L.bisectToSegment(t, e); let n = r[0], a = L.hueOf(n), o = r[1]; for (let t = 0; t < 3; t++)if (n[t] !== o[t]) { let r = -1, i = 255; n[t] < o[t] ? (r = L.criticalPlaneBelow(L.trueDelinearized(n[t])), i = L.criticalPlaneAbove(L.trueDelinearized(o[t]))) : (r = L.criticalPlaneAbove(L.trueDelinearized(n[t])), i = L.criticalPlaneBelow(L.trueDelinearized(o[t]))); for (let s = 0; s < 8 && !(Math.abs(i - r) <= 1); s++) { const s = Math.floor((r + i) / 2), c = L.CRITICAL_PLANES[s], h = L.setCoordinate(n, c, o, t), u = L.hueOf(h); L.areInCyclicOrder(a, e, u) ? (o = h, i = s) : (n = h, a = u, r = s) } } return L.midpoint(n, o) } static inverseChromaticAdaptation(e) { const r = Math.abs(e), n = Math.max(0, 27.13 * r / (400 - r)); return t(e) * Math.pow(n, 1 / .42) } static findResultByJ(t, e, r) { let n = 11 * Math.sqrt(r); const a = O.DEFAULT, o = 1 / Math.pow(1.64 - Math.pow(.29, a.n), .73), i = .25 * (Math.cos(t + 2) + 3.8) * (5e4 / 13) * a.nc * a.ncb, s = Math.sin(t), h = Math.cos(t); for (let t = 0; t < 5; t++) { const u = n / 100, l = 0 === e || 0 === n ? 0 : e / Math.sqrt(u), m = Math.pow(l * o, 1 / .9), d = a.aw * Math.pow(u, 1 / a.c / a.z) / a.nbb, f = 23 * (d + .305) * m / (23 * i + 11 * m * h + 108 * m * s), y = f * h, p = f * s, C = (460 * d + 451 * y + 288 * p) / 1403, P = (460 * d - 891 * y - 261 * p) / 1403, b = (460 * d - 220 * y - 6300 * p) / 1403, w = c([L.inverseChromaticAdaptation(C), L.inverseChromaticAdaptation(P), L.inverseChromaticAdaptation(b)], L.LINRGB_FROM_SCALED_DISCOUNT); if (w[0] < 0 || w[1] < 0 || w[2] < 0) return 0; const A = L.Y_FROM_LINRGB[0], M = L.Y_FROM_LINRGB[1], k = L.Y_FROM_LINRGB[2], x = A * w[0] + M * w[1] + k * w[2]; if (x <= 0) return 0; if (4 === t || Math.abs(x - r) < .002) return w[0] > 100.01 || w[1] > 100.01 || w[2] > 100.01 ? 0 : g(w); n -= (x - r) * n / (2 * x) } return 0 } static solveToInt(t, e, r) { if (e < 1e-4 || r < 1e-4 || r > 99.9999) return M(r); const n = (t = o(t)) / 180 * Math.PI, a = x(r), i = L.findResultByJ(n, e, a); if (0 !== i) return i; return g(L.bisectToLimit(a, n)) } static solveToCam(t, e, r) { return R.fromInt(L.solveToInt(t, e, r)) } } L.SCALED_DISCOUNT_FROM_LINRGB = [[.001200833568784504, .002389694492170889, .0002795742885861124], [.0005891086651375999, .0029785502573438758, .0003270666104008398], [.00010146692491640572, .0005364214359186694, .0032979401770712076]], L.LINRGB_FROM_SCALED_DISCOUNT = [[1373.2198709594231, -1100.4251190754821, -7.278681089101213], [-271.815969077903, 559.6580465940733, -32.46047482791194], [1.9622899599665666, -57.173814538844006, 308.7233197812385]], L.Y_FROM_LINRGB = [.2126, .7152, .0722], L.CRITICAL_PLANES = [.015176349177441876, .045529047532325624, .07588174588720938, .10623444424209313, .13658714259697685, .16693984095186062, .19729253930674434, .2276452376616281, .2579979360165119, .28835063437139563, .3188300904430532, .350925934958123, .3848314933096426, .42057480301049466, .458183274052838, .4976837250274023, .5391024159806381, .5824650784040898, .6277969426914107, .6751227633498623, .7244668422128921, .775853049866786, .829304845476233, .8848452951698498, .942497089126609, 1.0022825574869039, 1.0642236851973577, 1.1283421258858297, 1.1946592148522128, 1.2631959812511864, 1.3339731595349034, 1.407011200216447, 1.4823302800086415, 1.5599503113873272, 1.6398909516233677, 1.7221716113234105, 1.8068114625156377, 1.8938294463134073, 1.9832442801866852, 2.075074464868551, 2.1693382909216234, 2.2660538449872063, 2.36523901573795, 2.4669114995532007, 2.5710888059345764, 2.6777882626779785, 2.7870270208169257, 2.898822059350997, 3.0131901897720907, 3.1301480604002863, 3.2497121605402226, 3.3718988244681087, 3.4967242352587946, 3.624204428461639, 3.754355295633311, 3.887192587735158, 4.022731918402185, 4.160988767090289, 4.301978482107941, 4.445716283538092, 4.592217266055746, 4.741496401646282, 4.893568542229298, 5.048448422192488, 5.20615066083972, 5.3666897647573375, 5.5300801301023865, 5.696336044816294, 5.865471690767354, 6.037501145825082, 6.212438385869475, 6.390297286737924, 6.571091626112461, 6.7548350853498045, 6.941541251256611, 7.131223617812143, 7.323895587840543, 7.5195704746346665, 7.7182615035334345, 7.919981813454504, 8.124744458384042, 8.332562408825165, 8.543448553206703, 8.757415699253682, 8.974476575321063, 9.194643831691977, 9.417930041841839, 9.644347703669503, 9.873909240696694, 10.106627003236781, 10.342513269534024, 10.58158024687427, 10.8238400726681, 11.069304815507364, 11.317986476196008, 11.569896988756009, 11.825048221409341, 12.083451977536606, 12.345119996613247, 12.610063955123938, 12.878295467455942, 13.149826086772048, 13.42466730586372, 13.702830557985108, 13.984327217668513, 14.269168601521828, 14.55736596900856, 14.848930523210871, 15.143873411576273, 15.44220572664832, 15.743938506781891, 16.04908273684337, 16.35764934889634, 16.66964922287304, 16.985093187232053, 17.30399201960269, 17.62635644741625, 17.95219714852476, 18.281524751807332, 18.614349837764564, 18.95068293910138, 19.290534541298456, 19.633915083172692, 19.98083495742689, 20.331304511189067, 20.685334046541502, 21.042933821039977, 21.404114048223256, 21.76888489811322, 22.137256497705877, 22.50923893145328, 22.884842241736916, 23.264076429332462, 23.6469514538663, 24.033477234264016, 24.42366364919083, 24.817520537484558, 25.21505769858089, 25.61628489293138, 26.021211842414342, 26.429848230738664, 26.842203703840827, 27.258287870275353, 27.678110301598522, 28.10168053274597, 28.529008062403893, 28.96010235337422, 29.39497283293396, 29.83362889318845, 30.276079891419332, 30.722335150426627, 31.172403958865512, 31.62629557157785, 32.08401920991837, 32.54558406207592, 33.010999283389665, 33.4802739966603, 33.953417292456834, 34.430438229418264, 34.911345834551085, 35.39614910352207, 35.88485700094671, 36.37747846067349, 36.87402238606382, 37.37449765026789, 37.87891309649659, 38.38727753828926, 38.89959975977785, 39.41588851594697, 39.93615253289054, 40.460400508064545, 40.98864111053629, 41.520882981230194, 42.05713473317016, 42.597404951718396, 43.141702194811224, 43.6900349931913, 44.24241185063697, 44.798841244188324, 45.35933162437017, 45.92389141541209, 46.49252901546552, 47.065252796817916, 47.64207110610409, 48.22299226451468, 48.808024568002054, 49.3971762874833, 49.9904556690408, 50.587870934119984, 51.189430279724725, 51.79514187861014, 52.40501387947288, 53.0190544071392, 53.637271562750364, 54.259673423945976, 54.88626804504493, 55.517063457223934, 56.15206766869424, 56.79128866487574, 57.43473440856916, 58.08241284012621, 58.734331877617365, 59.39049941699807, 60.05092333227251, 60.715611475655585, 61.38457167773311, 62.057811747619894, 62.7353394731159, 63.417162620860914, 64.10328893648692, 64.79372614476921, 65.48848194977529, 66.18756403501224, 66.89098006357258, 67.59873767827808, 68.31084450182222, 69.02730813691093, 69.74813616640164, 70.47333615344107, 71.20291564160104, 71.93688215501312, 72.67524319850172, 73.41800625771542, 74.16517879925733, 74.9167682708136, 75.67278210128072, 76.43322770089146, 77.1981124613393, 77.96744375590167, 78.74122893956174, 79.51947534912904, 80.30219030335869, 81.08938110306934, 81.88105503125999, 82.67721935322541, 83.4778813166706, 84.28304815182372, 85.09272707154808, 85.90692527145302, 86.72564993000343, 87.54890820862819, 88.3767072518277, 89.2090541872801, 90.04595612594655, 90.88742016217518, 91.73345337380438, 92.58406282226491, 93.43925555268066, 94.29903859396902, 95.16341895893969, 96.03240364439274, 96.9059996312159, 97.78421388448044, 98.6670533535366, 99.55452497210776];
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
class V { static from(t, e, r) { return new V(L.solveToInt(t, e, r)) } static fromInt(t) { return new V(t) } toInt() { return this.argb } get hue() { return this.internalHue } set hue(t) { this.setInternalState(L.solveToInt(t, this.internalChroma, this.internalTone)) } get chroma() { return this.internalChroma } set chroma(t) { this.setInternalState(L.solveToInt(this.internalHue, t, this.internalTone)) } get tone() { return this.internalTone } set tone(t) { this.setInternalState(L.solveToInt(this.internalHue, this.internalChroma, t)) } constructor(t) { this.argb = t; const e = R.fromInt(t); this.internalHue = e.hue, this.internalChroma = e.chroma, this.internalTone = k(t), this.argb = t } setInternalState(t) { const e = R.fromInt(t); this.internalHue = e.hue, this.internalChroma = e.chroma, this.internalTone = k(t), this.argb = t } inViewingConditions(t) { const e = R.fromInt(this.toInt()).xyzInViewingConditions(t), r = R.fromXyzInViewingConditions(e[0], e[1], e[2], O.make()); return V.from(r.hue, r.chroma, I(e[1])) } }
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class E { static harmonize(t, e) { const r = V.fromInt(t), n = V.fromInt(e), a = s(r.hue, n.hue), c = Math.min(.5 * a, 15), h = o(r.hue + c * i(r.hue, n.hue)); return V.from(h, r.chroma, r.tone).toInt() } static hctHue(t, e, r) { const n = E.cam16Ucs(t, e, r), a = R.fromInt(n), o = R.fromInt(t); return V.from(a.hue, o.chroma, k(t)).toInt() } static cam16Ucs(t, e, r) { const n = R.fromInt(t), a = R.fromInt(e), o = n.jstar, i = n.astar, s = n.bstar, c = o + (a.jstar - o) * r, h = i + (a.astar - i) * r, u = s + (a.bstar - s) * r; return R.fromUcs(c, h, u).toInt() } }
/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class N { static ratioOfTones(t, e) { return t = n(0, 100, t), e = n(0, 100, e), N.ratioOfYs(x(t), x(e)) } static ratioOfYs(t, e) { const r = t > e ? t : e; return (r + 5) / ((r === e ? t : e) + 5) } static lighter(t, e) { if (t < 0 || t > 100) return -1; const r = x(t), n = e * (r + 5) - 5, a = N.ratioOfYs(n, r), o = Math.abs(a - e); if (a < e && o > .04) return -1; const i = I(n) + .4; return i < 0 || i > 100 ? -1 : i } static darker(t, e) { if (t < 0 || t > 100) return -1; const r = x(t), n = (r + 5) / e - 5, a = N.ratioOfYs(r, n), o = Math.abs(a - e); if (a < e && o > .04) return -1; const i = I(n) - .4; return i < 0 || i > 100 ? -1 : i } static lighterUnsafe(t, e) { const r = N.lighter(t, e); return r < 0 ? 100 : r } static darkerUnsafe(t, e) { const r = N.darker(t, e); return r < 0 ? 0 : r } }
/**
 * @license
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class z { static isDisliked(t) { const e = Math.round(t.hue) >= 90 && Math.round(t.hue) <= 111, r = Math.round(t.chroma) > 16, n = Math.round(t.tone) < 65; return e && r && n } static fixIfDisliked(t) { return z.isDisliked(t) ? V.from(t.hue, t.chroma, 70) : t } }
/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class q { static fromPalette(t) { return new q(t.name ?? "", t.palette, t.tone, t.isBackground ?? !1, t.background, t.secondBackground, t.contrastCurve, t.toneDeltaPair) } constructor(t, e, r, n, a, o, i, s) { if (this.name = t, this.palette = e, this.tone = r, this.isBackground = n, this.background = a, this.secondBackground = o, this.contrastCurve = i, this.toneDeltaPair = s, this.hctCache = new Map, !a && o) throw new Error(`Color ${t} has secondBackgrounddefined, but background is not defined.`); if (!a && i) throw new Error(`Color ${t} has contrastCurvedefined, but background is not defined.`); if (a && !i) throw new Error(`Color ${t} has backgrounddefined, but contrastCurve is not defined.`) } getArgb(t) { return this.getHct(t).toInt() } getHct(t) { const e = this.hctCache.get(t); if (null != e) return e; const r = this.getTone(t), n = this.palette(t).getHct(r); return this.hctCache.size > 4 && this.hctCache.clear(), this.hctCache.set(t, n), n } getTone(t) { const e = t.contrastLevel < 0; if (this.toneDeltaPair) { const r = this.toneDeltaPair(t), a = r.roleA, o = r.roleB, i = r.delta, s = r.polarity, c = r.stayTogether, h = this.background(t).getTone(t), u = "nearer" === s || "lighter" === s && !t.isDark || "darker" === s && t.isDark, l = u ? a : o, m = u ? o : a, g = this.name === l.name, d = t.isDark ? 1 : -1, f = l.contrastCurve.get(t.contrastLevel), y = m.contrastCurve.get(t.contrastLevel), p = l.tone(t); let C = N.ratioOfTones(h, p) >= f ? p : q.foregroundTone(h, f); const P = m.tone(t); let b = N.ratioOfTones(h, P) >= y ? P : q.foregroundTone(h, y); return e && (C = q.foregroundTone(h, f), b = q.foregroundTone(h, y)), (b - C) * d >= i || (b = n(0, 100, C + i * d), (b - C) * d >= i || (C = n(0, 100, b - i * d))), 50 <= C && C < 60 ? d > 0 ? (C = 60, b = Math.max(b, C + i * d)) : (C = 49, b = Math.min(b, C + i * d)) : 50 <= b && b < 60 && (c ? d > 0 ? (C = 60, b = Math.max(b, C + i * d)) : (C = 49, b = Math.min(b, C + i * d)) : b = d > 0 ? 60 : 49), g ? C : b } { let r = this.tone(t); if (null == this.background) return r; const n = this.background(t).getTone(t), a = this.contrastCurve.get(t.contrastLevel); if (N.ratioOfTones(n, r) >= a || (r = q.foregroundTone(n, a)), e && (r = q.foregroundTone(n, a)), this.isBackground && 50 <= r && r < 60 && (r = N.ratioOfTones(49, n) >= a ? 49 : 60), this.secondBackground) { const [e, n] = [this.background, this.secondBackground], [o, i] = [e(t).getTone(t), n(t).getTone(t)], [s, c] = [Math.max(o, i), Math.min(o, i)]; if (N.ratioOfTones(s, r) >= a && N.ratioOfTones(c, r) >= a) return r; const h = N.lighter(s, a), u = N.darker(c, a), l = []; -1 !== h && l.push(h), -1 !== u && l.push(u); return q.tonePrefersLightForeground(o) || q.tonePrefersLightForeground(i) ? h < 0 ? 100 : h : 1 === l.length ? l[0] : u < 0 ? 0 : u } return r } } static foregroundTone(t, e) { const r = N.lighterUnsafe(t, e), n = N.darkerUnsafe(t, e), a = N.ratioOfTones(r, t), o = N.ratioOfTones(n, t); if (q.tonePrefersLightForeground(t)) { const t = Math.abs(a - o) < .1 && a < e && o < e; return a >= e || a >= o || t ? r : n } return o >= e || o >= a ? n : r } static tonePrefersLightForeground(t) { return Math.round(t) < 60 } static toneAllowsLightForeground(t) { return Math.round(t) <= 49 } static enableLightForeground(t) { return q.tonePrefersLightForeground(t) && !q.toneAllowsLightForeground(t) ? 49 : t } }
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class G { static fromInt(t) { const e = V.fromInt(t); return G.fromHct(e) } static fromHct(t) { return new G(t.hue, t.chroma, t) } static fromHueAndChroma(t, e) { const r = new U(t, e).create(); return new G(t, e, r) } constructor(t, e, r) { this.hue = t, this.chroma = e, this.keyColor = r, this.cache = new Map } tone(t) { let e = this.cache.get(t); return void 0 === e && (e = V.from(this.hue, this.chroma, t).toInt(), this.cache.set(t, e)), e } getHct(t) { return V.fromInt(this.tone(t)) } } class U { constructor(t, e) { this.hue = t, this.requestedChroma = e, this.chromaCache = new Map, this.maxChromaValue = 200 } create() { let t = 0, e = 100; for (; t < e;) { const r = Math.floor((t + e) / 2), n = this.maxChroma(r) < this.maxChroma(r + 1); if (this.maxChroma(r) >= this.requestedChroma - .01) if (Math.abs(t - 50) < Math.abs(e - 50)) e = r; else { if (t === r) return V.from(this.hue, this.requestedChroma, t); t = r } else n ? t = r + 1 : e = r } return V.from(this.hue, this.requestedChroma, t) } maxChroma(t) { if (this.chromaCache.has(t)) return this.chromaCache.get(t); const e = V.from(this.hue, this.maxChromaValue, t).chroma; return this.chromaCache.set(t, e), e } }
/**
 * @license
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class $ { constructor(t, e, r, n) { this.low = t, this.normal = e, this.medium = r, this.high = n } get(t) { return t <= -1 ? this.low : t < 0 ? e(this.low, this.normal, (t - -1) / 1) : t < .5 ? e(this.normal, this.medium, (t - 0) / .5) : t < 1 ? e(this.medium, this.high, (t - .5) / .5) : this.high } }
/**
 * @license
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class j { constructor(t, e, r, n, a) { this.roleA = t, this.roleB = e, this.delta = r, this.polarity = n, this.stayTogether = a } }
/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */var K;
/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
function Y(t) { return t.variant === K.FIDELITY || t.variant === K.CONTENT } function W(t) { return t.variant === K.MONOCHROME } !function (t) { t[t.MONOCHROME = 0] = "MONOCHROME", t[t.NEUTRAL = 1] = "NEUTRAL", t[t.TONAL_SPOT = 2] = "TONAL_SPOT", t[t.VIBRANT = 3] = "VIBRANT", t[t.EXPRESSIVE = 4] = "EXPRESSIVE", t[t.FIDELITY = 5] = "FIDELITY", t[t.CONTENT = 6] = "CONTENT", t[t.RAINBOW = 7] = "RAINBOW", t[t.FRUIT_SALAD = 8] = "FRUIT_SALAD" }(K || (K = {})); class J { static highestSurface(t) { return t.isDark ? J.surfaceBright : J.surfaceDim } } J.contentAccentToneDelta = 15, J.primaryPaletteKeyColor = q.fromPalette({ name: "primary_palette_key_color", palette: t => t.primaryPalette, tone: t => t.primaryPalette.keyColor.tone }), J.secondaryPaletteKeyColor = q.fromPalette({ name: "secondary_palette_key_color", palette: t => t.secondaryPalette, tone: t => t.secondaryPalette.keyColor.tone }), J.tertiaryPaletteKeyColor = q.fromPalette({ name: "tertiary_palette_key_color", palette: t => t.tertiaryPalette, tone: t => t.tertiaryPalette.keyColor.tone }), J.neutralPaletteKeyColor = q.fromPalette({ name: "neutral_palette_key_color", palette: t => t.neutralPalette, tone: t => t.neutralPalette.keyColor.tone }), J.neutralVariantPaletteKeyColor = q.fromPalette({ name: "neutral_variant_palette_key_color", palette: t => t.neutralVariantPalette, tone: t => t.neutralVariantPalette.keyColor.tone }), J.background = q.fromPalette({ name: "background", palette: t => t.neutralPalette, tone: t => t.isDark ? 6 : 98, isBackground: !0 }), J.onBackground = q.fromPalette({ name: "on_background", palette: t => t.neutralPalette, tone: t => t.isDark ? 90 : 10, background: t => J.background, contrastCurve: new $(3, 3, 4.5, 7) }), J.surface = q.fromPalette({ name: "surface", palette: t => t.neutralPalette, tone: t => t.isDark ? 6 : 98, isBackground: !0 }), J.surfaceDim = q.fromPalette({ name: "surface_dim", palette: t => t.neutralPalette, tone: t => t.isDark ? 6 : new $(87, 87, 80, 75).get(t.contrastLevel), isBackground: !0 }), J.surfaceBright = q.fromPalette({ name: "surface_bright", palette: t => t.neutralPalette, tone: t => t.isDark ? new $(24, 24, 29, 34).get(t.contrastLevel) : 98, isBackground: !0 }), J.surfaceContainerLowest = q.fromPalette({ name: "surface_container_lowest", palette: t => t.neutralPalette, tone: t => t.isDark ? new $(4, 4, 2, 0).get(t.contrastLevel) : 100, isBackground: !0 }), J.surfaceContainerLow = q.fromPalette({ name: "surface_container_low", palette: t => t.neutralPalette, tone: t => t.isDark ? new $(10, 10, 11, 12).get(t.contrastLevel) : new $(96, 96, 96, 95).get(t.contrastLevel), isBackground: !0 }), J.surfaceContainer = q.fromPalette({ name: "surface_container", palette: t => t.neutralPalette, tone: t => t.isDark ? new $(12, 12, 16, 20).get(t.contrastLevel) : new $(94, 94, 92, 90).get(t.contrastLevel), isBackground: !0 }), J.surfaceContainerHigh = q.fromPalette({ name: "surface_container_high", palette: t => t.neutralPalette, tone: t => t.isDark ? new $(17, 17, 21, 25).get(t.contrastLevel) : new $(92, 92, 88, 85).get(t.contrastLevel), isBackground: !0 }), J.surfaceContainerHighest = q.fromPalette({ name: "surface_container_highest", palette: t => t.neutralPalette, tone: t => t.isDark ? new $(22, 22, 26, 30).get(t.contrastLevel) : new $(90, 90, 84, 80).get(t.contrastLevel), isBackground: !0 }), J.onSurface = q.fromPalette({ name: "on_surface", palette: t => t.neutralPalette, tone: t => t.isDark ? 90 : 10, background: t => J.highestSurface(t), contrastCurve: new $(4.5, 7, 11, 21) }), J.surfaceVariant = q.fromPalette({ name: "surface_variant", palette: t => t.neutralVariantPalette, tone: t => t.isDark ? 30 : 90, isBackground: !0 }), J.onSurfaceVariant = q.fromPalette({ name: "on_surface_variant", palette: t => t.neutralVariantPalette, tone: t => t.isDark ? 80 : 30, background: t => J.highestSurface(t), contrastCurve: new $(3, 4.5, 7, 11) }), J.inverseSurface = q.fromPalette({ name: "inverse_surface", palette: t => t.neutralPalette, tone: t => t.isDark ? 90 : 20 }), J.inverseOnSurface = q.fromPalette({ name: "inverse_on_surface", palette: t => t.neutralPalette, tone: t => t.isDark ? 20 : 95, background: t => J.inverseSurface, contrastCurve: new $(4.5, 7, 11, 21) }), J.outline = q.fromPalette({ name: "outline", palette: t => t.neutralVariantPalette, tone: t => t.isDark ? 60 : 50, background: t => J.highestSurface(t), contrastCurve: new $(1.5, 3, 4.5, 7) }), J.outlineVariant = q.fromPalette({ name: "outline_variant", palette: t => t.neutralVariantPalette, tone: t => t.isDark ? 30 : 80, background: t => J.highestSurface(t), contrastCurve: new $(1, 1, 3, 4.5) }), J.shadow = q.fromPalette({ name: "shadow", palette: t => t.neutralPalette, tone: t => 0 }), J.scrim = q.fromPalette({ name: "scrim", palette: t => t.neutralPalette, tone: t => 0 }), J.surfaceTint = q.fromPalette({ name: "surface_tint", palette: t => t.primaryPalette, tone: t => t.isDark ? 80 : 40, isBackground: !0 }), J.primary = q.fromPalette({ name: "primary", palette: t => t.primaryPalette, tone: t => W(t) ? t.isDark ? 100 : 0 : t.isDark ? 80 : 40, isBackground: !0, background: t => J.highestSurface(t), contrastCurve: new $(3, 4.5, 7, 7), toneDeltaPair: t => new j(J.primaryContainer, J.primary, 10, "nearer", !1) }), J.onPrimary = q.fromPalette({ name: "on_primary", palette: t => t.primaryPalette, tone: t => W(t) ? t.isDark ? 10 : 90 : t.isDark ? 20 : 100, background: t => J.primary, contrastCurve: new $(4.5, 7, 11, 21) }), J.primaryContainer = q.fromPalette({ name: "primary_container", palette: t => t.primaryPalette, tone: t => Y(t) ? t.sourceColorHct.tone : W(t) ? t.isDark ? 85 : 25 : t.isDark ? 30 : 90, isBackground: !0, background: t => J.highestSurface(t), contrastCurve: new $(1, 1, 3, 4.5), toneDeltaPair: t => new j(J.primaryContainer, J.primary, 10, "nearer", !1) }), J.onPrimaryContainer = q.fromPalette({ name: "on_primary_container", palette: t => t.primaryPalette, tone: t => Y(t) ? q.foregroundTone(J.primaryContainer.tone(t), 4.5) : W(t) ? t.isDark ? 0 : 100 : t.isDark ? 90 : 30, background: t => J.primaryContainer, contrastCurve: new $(3, 4.5, 7, 11) }), J.inversePrimary = q.fromPalette({ name: "inverse_primary", palette: t => t.primaryPalette, tone: t => t.isDark ? 40 : 80, background: t => J.inverseSurface, contrastCurve: new $(3, 4.5, 7, 7) }), J.secondary = q.fromPalette({ name: "secondary", palette: t => t.secondaryPalette, tone: t => t.isDark ? 80 : 40, isBackground: !0, background: t => J.highestSurface(t), contrastCurve: new $(3, 4.5, 7, 7), toneDeltaPair: t => new j(J.secondaryContainer, J.secondary, 10, "nearer", !1) }), J.onSecondary = q.fromPalette({ name: "on_secondary", palette: t => t.secondaryPalette, tone: t => W(t) ? t.isDark ? 10 : 100 : t.isDark ? 20 : 100, background: t => J.secondary, contrastCurve: new $(4.5, 7, 11, 21) }), J.secondaryContainer = q.fromPalette({ name: "secondary_container", palette: t => t.secondaryPalette, tone: t => { const e = t.isDark ? 30 : 90; return W(t) ? t.isDark ? 30 : 85 : Y(t) ? function (t, e, r, n) { let a = r, o = V.from(t, e, r); if (o.chroma < e) { let r = o.chroma; for (; o.chroma < e;) { a += n ? -1 : 1; const i = V.from(t, e, a); if (r > i.chroma) break; if (Math.abs(i.chroma - e) < .4) break; Math.abs(i.chroma - e) < Math.abs(o.chroma - e) && (o = i), r = Math.max(r, i.chroma) } } return a }(t.secondaryPalette.hue, t.secondaryPalette.chroma, e, !t.isDark) : e }, isBackground: !0, background: t => J.highestSurface(t), contrastCurve: new $(1, 1, 3, 4.5), toneDeltaPair: t => new j(J.secondaryContainer, J.secondary, 10, "nearer", !1) }), J.onSecondaryContainer = q.fromPalette({ name: "on_secondary_container", palette: t => t.secondaryPalette, tone: t => W(t) ? t.isDark ? 90 : 10 : Y(t) ? q.foregroundTone(J.secondaryContainer.tone(t), 4.5) : t.isDark ? 90 : 30, background: t => J.secondaryContainer, contrastCurve: new $(3, 4.5, 7, 11) }), J.tertiary = q.fromPalette({ name: "tertiary", palette: t => t.tertiaryPalette, tone: t => W(t) ? t.isDark ? 90 : 25 : t.isDark ? 80 : 40, isBackground: !0, background: t => J.highestSurface(t), contrastCurve: new $(3, 4.5, 7, 7), toneDeltaPair: t => new j(J.tertiaryContainer, J.tertiary, 10, "nearer", !1) }), J.onTertiary = q.fromPalette({ name: "on_tertiary", palette: t => t.tertiaryPalette, tone: t => W(t) ? t.isDark ? 10 : 90 : t.isDark ? 20 : 100, background: t => J.tertiary, contrastCurve: new $(4.5, 7, 11, 21) }), J.tertiaryContainer = q.fromPalette({ name: "tertiary_container", palette: t => t.tertiaryPalette, tone: t => { if (W(t)) return t.isDark ? 60 : 49; if (!Y(t)) return t.isDark ? 30 : 90; const e = t.tertiaryPalette.getHct(t.sourceColorHct.tone); return z.fixIfDisliked(e).tone }, isBackground: !0, background: t => J.highestSurface(t), contrastCurve: new $(1, 1, 3, 4.5), toneDeltaPair: t => new j(J.tertiaryContainer, J.tertiary, 10, "nearer", !1) }), J.onTertiaryContainer = q.fromPalette({ name: "on_tertiary_container", palette: t => t.tertiaryPalette, tone: t => W(t) ? t.isDark ? 0 : 100 : Y(t) ? q.foregroundTone(J.tertiaryContainer.tone(t), 4.5) : t.isDark ? 90 : 30, background: t => J.tertiaryContainer, contrastCurve: new $(3, 4.5, 7, 11) }), J.error = q.fromPalette({ name: "error", palette: t => t.errorPalette, tone: t => t.isDark ? 80 : 40, isBackground: !0, background: t => J.highestSurface(t), contrastCurve: new $(3, 4.5, 7, 7), toneDeltaPair: t => new j(J.errorContainer, J.error, 10, "nearer", !1) }), J.onError = q.fromPalette({ name: "on_error", palette: t => t.errorPalette, tone: t => t.isDark ? 20 : 100, background: t => J.error, contrastCurve: new $(4.5, 7, 11, 21) }), J.errorContainer = q.fromPalette({ name: "error_container", palette: t => t.errorPalette, tone: t => t.isDark ? 30 : 90, isBackground: !0, background: t => J.highestSurface(t), contrastCurve: new $(1, 1, 3, 4.5), toneDeltaPair: t => new j(J.errorContainer, J.error, 10, "nearer", !1) }), J.onErrorContainer = q.fromPalette({ name: "on_error_container", palette: t => t.errorPalette, tone: t => W(t) ? t.isDark ? 90 : 10 : t.isDark ? 90 : 30, background: t => J.errorContainer, contrastCurve: new $(3, 4.5, 7, 11) }), J.primaryFixed = q.fromPalette({ name: "primary_fixed", palette: t => t.primaryPalette, tone: t => W(t) ? 40 : 90, isBackground: !0, background: t => J.highestSurface(t), contrastCurve: new $(1, 1, 3, 4.5), toneDeltaPair: t => new j(J.primaryFixed, J.primaryFixedDim, 10, "lighter", !0) }), J.primaryFixedDim = q.fromPalette({ name: "primary_fixed_dim", palette: t => t.primaryPalette, tone: t => W(t) ? 30 : 80, isBackground: !0, background: t => J.highestSurface(t), contrastCurve: new $(1, 1, 3, 4.5), toneDeltaPair: t => new j(J.primaryFixed, J.primaryFixedDim, 10, "lighter", !0) }), J.onPrimaryFixed = q.fromPalette({ name: "on_primary_fixed", palette: t => t.primaryPalette, tone: t => W(t) ? 100 : 10, background: t => J.primaryFixedDim, secondBackground: t => J.primaryFixed, contrastCurve: new $(4.5, 7, 11, 21) }), J.onPrimaryFixedVariant = q.fromPalette({ name: "on_primary_fixed_variant", palette: t => t.primaryPalette, tone: t => W(t) ? 90 : 30, background: t => J.primaryFixedDim, secondBackground: t => J.primaryFixed, contrastCurve: new $(3, 4.5, 7, 11) }), J.secondaryFixed = q.fromPalette({ name: "secondary_fixed", palette: t => t.secondaryPalette, tone: t => W(t) ? 80 : 90, isBackground: !0, background: t => J.highestSurface(t), contrastCurve: new $(1, 1, 3, 4.5), toneDeltaPair: t => new j(J.secondaryFixed, J.secondaryFixedDim, 10, "lighter", !0) }), J.secondaryFixedDim = q.fromPalette({ name: "secondary_fixed_dim", palette: t => t.secondaryPalette, tone: t => W(t) ? 70 : 80, isBackground: !0, background: t => J.highestSurface(t), contrastCurve: new $(1, 1, 3, 4.5), toneDeltaPair: t => new j(J.secondaryFixed, J.secondaryFixedDim, 10, "lighter", !0) }), J.onSecondaryFixed = q.fromPalette({ name: "on_secondary_fixed", palette: t => t.secondaryPalette, tone: t => 10, background: t => J.secondaryFixedDim, secondBackground: t => J.secondaryFixed, contrastCurve: new $(4.5, 7, 11, 21) }), J.onSecondaryFixedVariant = q.fromPalette({ name: "on_secondary_fixed_variant", palette: t => t.secondaryPalette, tone: t => W(t) ? 25 : 30, background: t => J.secondaryFixedDim, secondBackground: t => J.secondaryFixed, contrastCurve: new $(3, 4.5, 7, 11) }), J.tertiaryFixed = q.fromPalette({ name: "tertiary_fixed", palette: t => t.tertiaryPalette, tone: t => W(t) ? 40 : 90, isBackground: !0, background: t => J.highestSurface(t), contrastCurve: new $(1, 1, 3, 4.5), toneDeltaPair: t => new j(J.tertiaryFixed, J.tertiaryFixedDim, 10, "lighter", !0) }), J.tertiaryFixedDim = q.fromPalette({ name: "tertiary_fixed_dim", palette: t => t.tertiaryPalette, tone: t => W(t) ? 30 : 80, isBackground: !0, background: t => J.highestSurface(t), contrastCurve: new $(1, 1, 3, 4.5), toneDeltaPair: t => new j(J.tertiaryFixed, J.tertiaryFixedDim, 10, "lighter", !0) }), J.onTertiaryFixed = q.fromPalette({ name: "on_tertiary_fixed", palette: t => t.tertiaryPalette, tone: t => W(t) ? 100 : 10, background: t => J.tertiaryFixedDim, secondBackground: t => J.tertiaryFixed, contrastCurve: new $(4.5, 7, 11, 21) }), J.onTertiaryFixedVariant = q.fromPalette({ name: "on_tertiary_fixed_variant", palette: t => t.tertiaryPalette, tone: t => W(t) ? 90 : 30, background: t => J.tertiaryFixedDim, secondBackground: t => J.tertiaryFixed, contrastCurve: new $(3, 4.5, 7, 11) });
/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
class X { constructor(t) { this.sourceColorArgb = t.sourceColorArgb, this.variant = t.variant, this.contrastLevel = t.contrastLevel, this.isDark = t.isDark, this.sourceColorHct = V.fromInt(t.sourceColorArgb), this.primaryPalette = t.primaryPalette, this.secondaryPalette = t.secondaryPalette, this.tertiaryPalette = t.tertiaryPalette, this.neutralPalette = t.neutralPalette, this.neutralVariantPalette = t.neutralVariantPalette, this.errorPalette = G.fromHueAndChroma(25, 84) } static getRotatedHue(t, e, r) { const n = t.hue; if (e.length !== r.length) throw new Error(`mismatch between hue length ${e.length} & rotations ${r.length}`); if (1 === r.length) return o(t.hue + r[0]); const a = e.length; for (let t = 0; t <= a - 2; t++) { const a = e[t], i = e[t + 1]; if (a < n && n < i) return o(n + r[t]) } return n } getArgb(t) { return t.getArgb(this) } getHct(t) { return t.getHct(this) } get primaryPaletteKeyColor() { return this.getArgb(J.primaryPaletteKeyColor) } get secondaryPaletteKeyColor() { return this.getArgb(J.secondaryPaletteKeyColor) } get tertiaryPaletteKeyColor() { return this.getArgb(J.tertiaryPaletteKeyColor) } get neutralPaletteKeyColor() { return this.getArgb(J.neutralPaletteKeyColor) } get neutralVariantPaletteKeyColor() { return this.getArgb(J.neutralVariantPaletteKeyColor) } get background() { return this.getArgb(J.background) } get onBackground() { return this.getArgb(J.onBackground) } get surface() { return this.getArgb(J.surface) } get surfaceDim() { return this.getArgb(J.surfaceDim) } get surfaceBright() { return this.getArgb(J.surfaceBright) } get surfaceContainerLowest() { return this.getArgb(J.surfaceContainerLowest) } get surfaceContainerLow() { return this.getArgb(J.surfaceContainerLow) } get surfaceContainer() { return this.getArgb(J.surfaceContainer) } get surfaceContainerHigh() { return this.getArgb(J.surfaceContainerHigh) } get surfaceContainerHighest() { return this.getArgb(J.surfaceContainerHighest) } get onSurface() { return this.getArgb(J.onSurface) } get surfaceVariant() { return this.getArgb(J.surfaceVariant) } get onSurfaceVariant() { return this.getArgb(J.onSurfaceVariant) } get inverseSurface() { return this.getArgb(J.inverseSurface) } get inverseOnSurface() { return this.getArgb(J.inverseOnSurface) } get outline() { return this.getArgb(J.outline) } get outlineVariant() { return this.getArgb(J.outlineVariant) } get shadow() { return this.getArgb(J.shadow) } get scrim() { return this.getArgb(J.scrim) } get surfaceTint() { return this.getArgb(J.surfaceTint) } get primary() { return this.getArgb(J.primary) } get onPrimary() { return this.getArgb(J.onPrimary) } get primaryContainer() { return this.getArgb(J.primaryContainer) } get onPrimaryContainer() { return this.getArgb(J.onPrimaryContainer) } get inversePrimary() { return this.getArgb(J.inversePrimary) } get secondary() { return this.getArgb(J.secondary) } get onSecondary() { return this.getArgb(J.onSecondary) } get secondaryContainer() { return this.getArgb(J.secondaryContainer) } get onSecondaryContainer() { return this.getArgb(J.onSecondaryContainer) } get tertiary() { return this.getArgb(J.tertiary) } get onTertiary() { return this.getArgb(J.onTertiary) } get tertiaryContainer() { return this.getArgb(J.tertiaryContainer) } get onTertiaryContainer() { return this.getArgb(J.onTertiaryContainer) } get error() { return this.getArgb(J.error) } get onError() { return this.getArgb(J.onError) } get errorContainer() { return this.getArgb(J.errorContainer) } get onErrorContainer() { return this.getArgb(J.onErrorContainer) } get primaryFixed() { return this.getArgb(J.primaryFixed) } get primaryFixedDim() { return this.getArgb(J.primaryFixedDim) } get onPrimaryFixed() { return this.getArgb(J.onPrimaryFixed) } get onPrimaryFixedVariant() { return this.getArgb(J.onPrimaryFixedVariant) } get secondaryFixed() { return this.getArgb(J.secondaryFixed) } get secondaryFixedDim() { return this.getArgb(J.secondaryFixedDim) } get onSecondaryFixed() { return this.getArgb(J.onSecondaryFixed) } get onSecondaryFixedVariant() { return this.getArgb(J.onSecondaryFixedVariant) } get tertiaryFixed() { return this.getArgb(J.tertiaryFixed) } get tertiaryFixedDim() { return this.getArgb(J.tertiaryFixedDim) } get onTertiaryFixed() { return this.getArgb(J.onTertiaryFixed) } get onTertiaryFixedVariant() { return this.getArgb(J.onTertiaryFixedVariant) } }
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Z { static of(t) { return new Z(t, !1) } static contentOf(t) { return new Z(t, !0) } static fromColors(t) { return Z.createPaletteFromColors(!1, t) } static contentFromColors(t) { return Z.createPaletteFromColors(!0, t) } static createPaletteFromColors(t, e) { const r = new Z(e.primary, t); if (e.secondary) { const n = new Z(e.secondary, t); r.a2 = n.a1 } if (e.tertiary) { const n = new Z(e.tertiary, t); r.a3 = n.a1 } if (e.error) { const n = new Z(e.error, t); r.error = n.a1 } if (e.neutral) { const n = new Z(e.neutral, t); r.n1 = n.n1 } if (e.neutralVariant) { const n = new Z(e.neutralVariant, t); r.n2 = n.n2 } return r } constructor(t, e) { const r = V.fromInt(t), n = r.hue, a = r.chroma; e ? (this.a1 = G.fromHueAndChroma(n, a), this.a2 = G.fromHueAndChroma(n, a / 3), this.a3 = G.fromHueAndChroma(n + 60, a / 2), this.n1 = G.fromHueAndChroma(n, Math.min(a / 12, 4)), this.n2 = G.fromHueAndChroma(n, Math.min(a / 6, 8))) : (this.a1 = G.fromHueAndChroma(n, Math.max(48, a)), this.a2 = G.fromHueAndChroma(n, 16), this.a3 = G.fromHueAndChroma(n + 60, 24), this.n1 = G.fromHueAndChroma(n, 4), this.n2 = G.fromHueAndChroma(n, 8)), this.error = G.fromHueAndChroma(25, 84) } }
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Q { fromInt(t) { return A(t) } toInt(t) { return w(t[0], t[1], t[2]) } distance(t, e) { const r = t[0] - e[0], n = t[1] - e[1], a = t[2] - e[2]; return r * r + n * n + a * a } }
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class tt { static quantize(t, e, r) { const n = new Map, a = new Array, o = new Array, i = new Q; let s = 0; for (let e = 0; e < t.length; e++) { const r = t[e], c = n.get(r); void 0 === c ? (s++, a.push(i.fromInt(r)), o.push(r), n.set(r, 1)) : n.set(r, c + 1) } const c = new Array; for (let t = 0; t < s; t++) { const e = o[t], r = n.get(e); void 0 !== r && (c[t] = r) } let h = Math.min(r, s); e.length > 0 && (h = Math.min(h, e.length)); const u = new Array; for (let t = 0; t < e.length; t++)u.push(i.fromInt(e[t])); const l = h - u.length; if (0 === e.length && l > 0) for (let t = 0; t < l; t++) { const t = 100 * Math.random(), e = 201 * Math.random() - 100, r = 201 * Math.random() - 100; u.push(new Array(t, e, r)) } const m = new Array; for (let t = 0; t < s; t++)m.push(Math.floor(Math.random() * h)); const g = new Array; for (let t = 0; t < h; t++) { g.push(new Array); for (let e = 0; e < h; e++)g[t].push(0) } const d = new Array; for (let t = 0; t < h; t++) { d.push(new Array); for (let e = 0; e < h; e++)d[t].push(new et) } const f = new Array; for (let t = 0; t < h; t++)f.push(0); for (let t = 0; t < 10; t++) { for (let t = 0; t < h; t++) { for (let e = t + 1; e < h; e++) { const r = i.distance(u[t], u[e]); d[e][t].distance = r, d[e][t].index = t, d[t][e].distance = r, d[t][e].index = e } d[t].sort(); for (let e = 0; e < h; e++)g[t][e] = d[t][e].index } let e = 0; for (let t = 0; t < s; t++) { const r = a[t], n = m[t], o = u[n], s = i.distance(r, o); let c = s, l = -1; for (let t = 0; t < h; t++) { if (d[n][t].distance >= 4 * s) continue; const e = i.distance(r, u[t]); e < c && (c = e, l = t) } if (-1 !== l) { Math.abs(Math.sqrt(c) - Math.sqrt(s)) > 3 && (e++, m[t] = l) } } if (0 === e && 0 !== t) break; const r = new Array(h).fill(0), n = new Array(h).fill(0), o = new Array(h).fill(0); for (let t = 0; t < h; t++)f[t] = 0; for (let t = 0; t < s; t++) { const e = m[t], i = a[t], s = c[t]; f[e] += s, r[e] += i[0] * s, n[e] += i[1] * s, o[e] += i[2] * s } for (let t = 0; t < h; t++) { const e = f[t]; if (0 === e) { u[t] = [0, 0, 0]; continue } const a = r[t] / e, i = n[t] / e, s = o[t] / e; u[t] = [a, i, s] } } const y = new Map; for (let t = 0; t < h; t++) { const e = f[t]; if (0 === e) continue; const r = i.toInt(u[t]); y.has(r) || y.set(r, e) } return y } } class et { constructor() { this.distance = -1, this.index = -1 } }
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class rt { static quantize(t) { const e = new Map; for (let r = 0; r < t.length; r++) { const n = t[r]; d(n) < 255 || e.set(n, (e.get(n) ?? 0) + 1) } return e } }
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const nt = 33, at = 35937, ot = "red", it = "green", st = "blue"; class ct { constructor(t = [], e = [], r = [], n = [], a = [], o = []) { this.weights = t, this.momentsR = e, this.momentsG = r, this.momentsB = n, this.moments = a, this.cubes = o } quantize(t, e) { this.constructHistogram(t), this.computeMoments(); const r = this.createBoxes(e); return this.createResult(r.resultCount) } constructHistogram(t) { this.weights = Array.from({ length: at }).fill(0), this.momentsR = Array.from({ length: at }).fill(0), this.momentsG = Array.from({ length: at }).fill(0), this.momentsB = Array.from({ length: at }).fill(0), this.moments = Array.from({ length: at }).fill(0); const e = rt.quantize(t); for (const [t, r] of e.entries()) { const e = f(t), n = y(t), a = p(t), o = 3, i = 1 + (e >> o), s = 1 + (n >> o), c = 1 + (a >> o), h = this.getIndex(i, s, c); this.weights[h] = (this.weights[h] ?? 0) + r, this.momentsR[h] += r * e, this.momentsG[h] += r * n, this.momentsB[h] += r * a, this.moments[h] += r * (e * e + n * n + a * a) } } computeMoments() { for (let t = 1; t < nt; t++) { const e = Array.from({ length: nt }).fill(0), r = Array.from({ length: nt }).fill(0), n = Array.from({ length: nt }).fill(0), a = Array.from({ length: nt }).fill(0), o = Array.from({ length: nt }).fill(0); for (let i = 1; i < nt; i++) { let s = 0, c = 0, h = 0, u = 0, l = 0; for (let m = 1; m < nt; m++) { const g = this.getIndex(t, i, m); s += this.weights[g], c += this.momentsR[g], h += this.momentsG[g], u += this.momentsB[g], l += this.moments[g], e[m] += s, r[m] += c, n[m] += h, a[m] += u, o[m] += l; const d = this.getIndex(t - 1, i, m); this.weights[g] = this.weights[d] + e[m], this.momentsR[g] = this.momentsR[d] + r[m], this.momentsG[g] = this.momentsG[d] + n[m], this.momentsB[g] = this.momentsB[d] + a[m], this.moments[g] = this.moments[d] + o[m] } } } } createBoxes(t) { this.cubes = Array.from({ length: t }).fill(0).map((() => new ht)); const e = Array.from({ length: t }).fill(0); this.cubes[0].r0 = 0, this.cubes[0].g0 = 0, this.cubes[0].b0 = 0, this.cubes[0].r1 = 32, this.cubes[0].g1 = 32, this.cubes[0].b1 = 32; let r = t, n = 0; for (let a = 1; a < t; a++) { this.cut(this.cubes[n], this.cubes[a]) ? (e[n] = this.cubes[n].vol > 1 ? this.variance(this.cubes[n]) : 0, e[a] = this.cubes[a].vol > 1 ? this.variance(this.cubes[a]) : 0) : (e[n] = 0, a--), n = 0; let t = e[0]; for (let r = 1; r <= a; r++)e[r] > t && (t = e[r], n = r); if (t <= 0) { r = a + 1; break } } return new ut(t, r) } createResult(t) { const e = []; for (let r = 0; r < t; ++r) { const t = this.cubes[r], n = this.volume(t, this.weights); if (n > 0) { const r = 255 << 24 | (255 & Math.round(this.volume(t, this.momentsR) / n)) << 16 | (255 & Math.round(this.volume(t, this.momentsG) / n)) << 8 | 255 & Math.round(this.volume(t, this.momentsB) / n); e.push(r) } } return e } variance(t) { const e = this.volume(t, this.momentsR), r = this.volume(t, this.momentsG), n = this.volume(t, this.momentsB); return this.moments[this.getIndex(t.r1, t.g1, t.b1)] - this.moments[this.getIndex(t.r1, t.g1, t.b0)] - this.moments[this.getIndex(t.r1, t.g0, t.b1)] + this.moments[this.getIndex(t.r1, t.g0, t.b0)] - this.moments[this.getIndex(t.r0, t.g1, t.b1)] + this.moments[this.getIndex(t.r0, t.g1, t.b0)] + this.moments[this.getIndex(t.r0, t.g0, t.b1)] - this.moments[this.getIndex(t.r0, t.g0, t.b0)] - (e * e + r * r + n * n) / this.volume(t, this.weights) } cut(t, e) { const r = this.volume(t, this.momentsR), n = this.volume(t, this.momentsG), a = this.volume(t, this.momentsB), o = this.volume(t, this.weights), i = this.maximize(t, ot, t.r0 + 1, t.r1, r, n, a, o), s = this.maximize(t, it, t.g0 + 1, t.g1, r, n, a, o), c = this.maximize(t, st, t.b0 + 1, t.b1, r, n, a, o); let h; const u = i.maximum, l = s.maximum, m = c.maximum; if (u >= l && u >= m) { if (i.cutLocation < 0) return !1; h = ot } else h = l >= u && l >= m ? it : st; switch (e.r1 = t.r1, e.g1 = t.g1, e.b1 = t.b1, h) { case ot: t.r1 = i.cutLocation, e.r0 = t.r1, e.g0 = t.g0, e.b0 = t.b0; break; case it: t.g1 = s.cutLocation, e.r0 = t.r0, e.g0 = t.g1, e.b0 = t.b0; break; case st: t.b1 = c.cutLocation, e.r0 = t.r0, e.g0 = t.g0, e.b0 = t.b1; break; default: throw new Error("unexpected direction " + h) }return t.vol = (t.r1 - t.r0) * (t.g1 - t.g0) * (t.b1 - t.b0), e.vol = (e.r1 - e.r0) * (e.g1 - e.g0) * (e.b1 - e.b0), !0 } maximize(t, e, r, n, a, o, i, s) { const c = this.bottom(t, e, this.momentsR), h = this.bottom(t, e, this.momentsG), u = this.bottom(t, e, this.momentsB), l = this.bottom(t, e, this.weights); let m = 0, g = -1, d = 0, f = 0, y = 0, p = 0; for (let C = r; C < n; C++) { if (d = c + this.top(t, e, C, this.momentsR), f = h + this.top(t, e, C, this.momentsG), y = u + this.top(t, e, C, this.momentsB), p = l + this.top(t, e, C, this.weights), 0 === p) continue; let r = 1 * (d * d + f * f + y * y), n = 1 * p, P = r / n; d = a - d, f = o - f, y = i - y, p = s - p, 0 !== p && (r = 1 * (d * d + f * f + y * y), n = 1 * p, P += r / n, P > m && (m = P, g = C)) } return new lt(g, m) } volume(t, e) { return e[this.getIndex(t.r1, t.g1, t.b1)] - e[this.getIndex(t.r1, t.g1, t.b0)] - e[this.getIndex(t.r1, t.g0, t.b1)] + e[this.getIndex(t.r1, t.g0, t.b0)] - e[this.getIndex(t.r0, t.g1, t.b1)] + e[this.getIndex(t.r0, t.g1, t.b0)] + e[this.getIndex(t.r0, t.g0, t.b1)] - e[this.getIndex(t.r0, t.g0, t.b0)] } bottom(t, e, r) { switch (e) { case ot: return -r[this.getIndex(t.r0, t.g1, t.b1)] + r[this.getIndex(t.r0, t.g1, t.b0)] + r[this.getIndex(t.r0, t.g0, t.b1)] - r[this.getIndex(t.r0, t.g0, t.b0)]; case it: return -r[this.getIndex(t.r1, t.g0, t.b1)] + r[this.getIndex(t.r1, t.g0, t.b0)] + r[this.getIndex(t.r0, t.g0, t.b1)] - r[this.getIndex(t.r0, t.g0, t.b0)]; case st: return -r[this.getIndex(t.r1, t.g1, t.b0)] + r[this.getIndex(t.r1, t.g0, t.b0)] + r[this.getIndex(t.r0, t.g1, t.b0)] - r[this.getIndex(t.r0, t.g0, t.b0)]; default: throw new Error("unexpected direction $direction") } } top(t, e, r, n) { switch (e) { case ot: return n[this.getIndex(r, t.g1, t.b1)] - n[this.getIndex(r, t.g1, t.b0)] - n[this.getIndex(r, t.g0, t.b1)] + n[this.getIndex(r, t.g0, t.b0)]; case it: return n[this.getIndex(t.r1, r, t.b1)] - n[this.getIndex(t.r1, r, t.b0)] - n[this.getIndex(t.r0, r, t.b1)] + n[this.getIndex(t.r0, r, t.b0)]; case st: return n[this.getIndex(t.r1, t.g1, r)] - n[this.getIndex(t.r1, t.g0, r)] - n[this.getIndex(t.r0, t.g1, r)] + n[this.getIndex(t.r0, t.g0, r)]; default: throw new Error("unexpected direction $direction") } } getIndex(t, e, r) { return (t << 10) + (t << 6) + t + (e << 5) + e + r } } class ht { constructor(t = 0, e = 0, r = 0, n = 0, a = 0, o = 0, i = 0) { this.r0 = t, this.r1 = e, this.g0 = r, this.g1 = n, this.b0 = a, this.b1 = o, this.vol = i } } class ut { constructor(t, e) { this.requestedCount = t, this.resultCount = e } } class lt { constructor(t, e) { this.cutLocation = t, this.maximum = e } }
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class mt { static quantize(t, e) { const r = (new ct).quantize(t, e); return tt.quantize(t, r, e) } }
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class gt { get primary() { return this.props.primary } get onPrimary() { return this.props.onPrimary } get primaryContainer() { return this.props.primaryContainer } get onPrimaryContainer() { return this.props.onPrimaryContainer } get secondary() { return this.props.secondary } get onSecondary() { return this.props.onSecondary } get secondaryContainer() { return this.props.secondaryContainer } get onSecondaryContainer() { return this.props.onSecondaryContainer } get tertiary() { return this.props.tertiary } get onTertiary() { return this.props.onTertiary } get tertiaryContainer() { return this.props.tertiaryContainer } get onTertiaryContainer() { return this.props.onTertiaryContainer } get error() { return this.props.error } get onError() { return this.props.onError } get errorContainer() { return this.props.errorContainer } get onErrorContainer() { return this.props.onErrorContainer } get background() { return this.props.background } get onBackground() { return this.props.onBackground } get surface() { return this.props.surface } get onSurface() { return this.props.onSurface } get surfaceVariant() { return this.props.surfaceVariant } get onSurfaceVariant() { return this.props.onSurfaceVariant } get outline() { return this.props.outline } get outlineVariant() { return this.props.outlineVariant } get shadow() { return this.props.shadow } get scrim() { return this.props.scrim } get inverseSurface() { return this.props.inverseSurface } get inverseOnSurface() { return this.props.inverseOnSurface } get inversePrimary() { return this.props.inversePrimary } static light(t) { return gt.lightFromCorePalette(Z.of(t)) } static dark(t) { return gt.darkFromCorePalette(Z.of(t)) } static lightContent(t) { return gt.lightFromCorePalette(Z.contentOf(t)) } static darkContent(t) { return gt.darkFromCorePalette(Z.contentOf(t)) } static lightFromCorePalette(t) { return new gt({ primary: t.a1.tone(40), onPrimary: t.a1.tone(100), primaryContainer: t.a1.tone(90), onPrimaryContainer: t.a1.tone(10), secondary: t.a2.tone(40), onSecondary: t.a2.tone(100), secondaryContainer: t.a2.tone(90), onSecondaryContainer: t.a2.tone(10), tertiary: t.a3.tone(40), onTertiary: t.a3.tone(100), tertiaryContainer: t.a3.tone(90), onTertiaryContainer: t.a3.tone(10), error: t.error.tone(40), onError: t.error.tone(100), errorContainer: t.error.tone(90), onErrorContainer: t.error.tone(10), background: t.n1.tone(99), onBackground: t.n1.tone(10), surface: t.n1.tone(99), onSurface: t.n1.tone(10), surfaceVariant: t.n2.tone(90), onSurfaceVariant: t.n2.tone(30), outline: t.n2.tone(50), outlineVariant: t.n2.tone(80), shadow: t.n1.tone(0), scrim: t.n1.tone(0), inverseSurface: t.n1.tone(20), inverseOnSurface: t.n1.tone(95), inversePrimary: t.a1.tone(80) }) } static darkFromCorePalette(t) { return new gt({ primary: t.a1.tone(80), onPrimary: t.a1.tone(20), primaryContainer: t.a1.tone(30), onPrimaryContainer: t.a1.tone(90), secondary: t.a2.tone(80), onSecondary: t.a2.tone(20), secondaryContainer: t.a2.tone(30), onSecondaryContainer: t.a2.tone(90), tertiary: t.a3.tone(80), onTertiary: t.a3.tone(20), tertiaryContainer: t.a3.tone(30), onTertiaryContainer: t.a3.tone(90), error: t.error.tone(80), onError: t.error.tone(20), errorContainer: t.error.tone(30), onErrorContainer: t.error.tone(80), background: t.n1.tone(10), onBackground: t.n1.tone(90), surface: t.n1.tone(10), onSurface: t.n1.tone(90), surfaceVariant: t.n2.tone(30), onSurfaceVariant: t.n2.tone(80), outline: t.n2.tone(60), outlineVariant: t.n2.tone(30), shadow: t.n1.tone(0), scrim: t.n1.tone(0), inverseSurface: t.n1.tone(90), inverseOnSurface: t.n1.tone(20), inversePrimary: t.a1.tone(40) }) } constructor(t) { this.props = t } toJSON() { return { ...this.props } } }
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class dt { get colorAccentPrimary() { return this.props.colorAccentPrimary } get colorAccentPrimaryVariant() { return this.props.colorAccentPrimaryVariant } get colorAccentSecondary() { return this.props.colorAccentSecondary } get colorAccentSecondaryVariant() { return this.props.colorAccentSecondaryVariant } get colorAccentTertiary() { return this.props.colorAccentTertiary } get colorAccentTertiaryVariant() { return this.props.colorAccentTertiaryVariant } get textColorPrimary() { return this.props.textColorPrimary } get textColorSecondary() { return this.props.textColorSecondary } get textColorTertiary() { return this.props.textColorTertiary } get textColorPrimaryInverse() { return this.props.textColorPrimaryInverse } get textColorSecondaryInverse() { return this.props.textColorSecondaryInverse } get textColorTertiaryInverse() { return this.props.textColorTertiaryInverse } get colorBackground() { return this.props.colorBackground } get colorBackgroundFloating() { return this.props.colorBackgroundFloating } get colorSurface() { return this.props.colorSurface } get colorSurfaceVariant() { return this.props.colorSurfaceVariant } get colorSurfaceHighlight() { return this.props.colorSurfaceHighlight } get surfaceHeader() { return this.props.surfaceHeader } get underSurface() { return this.props.underSurface } get offState() { return this.props.offState } get accentSurface() { return this.props.accentSurface } get textPrimaryOnAccent() { return this.props.textPrimaryOnAccent } get textSecondaryOnAccent() { return this.props.textSecondaryOnAccent } get volumeBackground() { return this.props.volumeBackground } get scrim() { return this.props.scrim } static light(t) { const e = Z.of(t); return dt.lightFromCorePalette(e) } static dark(t) { const e = Z.of(t); return dt.darkFromCorePalette(e) } static lightContent(t) { const e = Z.contentOf(t); return dt.lightFromCorePalette(e) } static darkContent(t) { const e = Z.contentOf(t); return dt.darkFromCorePalette(e) } static lightFromCorePalette(t) { return new dt({ colorAccentPrimary: t.a1.tone(90), colorAccentPrimaryVariant: t.a1.tone(40), colorAccentSecondary: t.a2.tone(90), colorAccentSecondaryVariant: t.a2.tone(40), colorAccentTertiary: t.a3.tone(90), colorAccentTertiaryVariant: t.a3.tone(40), textColorPrimary: t.n1.tone(10), textColorSecondary: t.n2.tone(30), textColorTertiary: t.n2.tone(50), textColorPrimaryInverse: t.n1.tone(95), textColorSecondaryInverse: t.n1.tone(80), textColorTertiaryInverse: t.n1.tone(60), colorBackground: t.n1.tone(95), colorBackgroundFloating: t.n1.tone(98), colorSurface: t.n1.tone(98), colorSurfaceVariant: t.n1.tone(90), colorSurfaceHighlight: t.n1.tone(100), surfaceHeader: t.n1.tone(90), underSurface: t.n1.tone(0), offState: t.n1.tone(20), accentSurface: t.a2.tone(95), textPrimaryOnAccent: t.n1.tone(10), textSecondaryOnAccent: t.n2.tone(30), volumeBackground: t.n1.tone(25), scrim: t.n1.tone(80) }) } static darkFromCorePalette(t) { return new dt({ colorAccentPrimary: t.a1.tone(90), colorAccentPrimaryVariant: t.a1.tone(70), colorAccentSecondary: t.a2.tone(90), colorAccentSecondaryVariant: t.a2.tone(70), colorAccentTertiary: t.a3.tone(90), colorAccentTertiaryVariant: t.a3.tone(70), textColorPrimary: t.n1.tone(95), textColorSecondary: t.n2.tone(80), textColorTertiary: t.n2.tone(60), textColorPrimaryInverse: t.n1.tone(10), textColorSecondaryInverse: t.n1.tone(30), textColorTertiaryInverse: t.n1.tone(50), colorBackground: t.n1.tone(10), colorBackgroundFloating: t.n1.tone(10), colorSurface: t.n1.tone(20), colorSurfaceVariant: t.n1.tone(30), colorSurfaceHighlight: t.n1.tone(35), surfaceHeader: t.n1.tone(30), underSurface: t.n1.tone(0), offState: t.n1.tone(20), accentSurface: t.a2.tone(95), textPrimaryOnAccent: t.n1.tone(10), textSecondaryOnAccent: t.n2.tone(30), volumeBackground: t.n1.tone(25), scrim: t.n1.tone(80) }) } constructor(t) { this.props = t } toJSON() { return { ...this.props } } }
/**
 * @license
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class ft { constructor(t) { this.input = t, this.hctsByTempCache = [], this.hctsByHueCache = [], this.tempsByHctCache = new Map, this.inputRelativeTemperatureCache = -1, this.complementCache = null } get hctsByTemp() { if (this.hctsByTempCache.length > 0) return this.hctsByTempCache; const t = this.hctsByHue.concat([this.input]), e = this.tempsByHct; return t.sort(((t, r) => e.get(t) - e.get(r))), this.hctsByTempCache = t, t } get warmest() { return this.hctsByTemp[this.hctsByTemp.length - 1] } get coldest() { return this.hctsByTemp[0] } analogous(t = 5, e = 12) { const r = Math.round(this.input.hue), n = this.hctsByHue[r]; let o = this.relativeTemperature(n); const i = [n]; let s = 0; for (let t = 0; t < 360; t++) { const e = a(r + t), n = this.hctsByHue[e], i = this.relativeTemperature(n), c = Math.abs(i - o); o = i, s += c } let c = 1; const h = s / e; let u = 0; for (o = this.relativeTemperature(n); i.length < e;) { const t = a(r + c), n = this.hctsByHue[t], s = this.relativeTemperature(n); u += Math.abs(s - o); let l = u >= i.length * h, m = 1; for (; l && i.length < e;) { i.push(n); l = u >= (i.length + m) * h, m++ } if (o = s, c++, c > 360) { for (; i.length < e;)i.push(n); break } } const l = [this.input], m = Math.floor((t - 1) / 2); for (let t = 1; t < m + 1; t++) { let e = 0 - t; for (; e < 0;)e = i.length + e; e >= i.length && (e %= i.length), l.splice(0, 0, i[e]) } const g = t - m - 1; for (let t = 1; t < g + 1; t++) { let e = t; for (; e < 0;)e = i.length + e; e >= i.length && (e %= i.length), l.push(i[e]) } return l } get complement() { if (null != this.complementCache) return this.complementCache; const t = this.coldest.hue, e = this.tempsByHct.get(this.coldest), r = this.warmest.hue, n = this.tempsByHct.get(this.warmest) - e, a = ft.isBetween(this.input.hue, t, r), i = a ? r : t, s = a ? t : r; let c = 1e3, h = this.hctsByHue[Math.round(this.input.hue)]; const u = 1 - this.inputRelativeTemperature; for (let t = 0; t <= 360; t += 1) { const r = o(i + 1 * t); if (!ft.isBetween(r, i, s)) continue; const a = this.hctsByHue[Math.round(r)], l = (this.tempsByHct.get(a) - e) / n, m = Math.abs(u - l); m < c && (c = m, h = a) } return this.complementCache = h, this.complementCache } relativeTemperature(t) { const e = this.tempsByHct.get(this.warmest) - this.tempsByHct.get(this.coldest), r = this.tempsByHct.get(t) - this.tempsByHct.get(this.coldest); return 0 === e ? .5 : r / e } get inputRelativeTemperature() { return this.inputRelativeTemperatureCache >= 0 || (this.inputRelativeTemperatureCache = this.relativeTemperature(this.input)), this.inputRelativeTemperatureCache } get tempsByHct() { if (this.tempsByHctCache.size > 0) return this.tempsByHctCache; const t = this.hctsByHue.concat([this.input]), e = new Map; for (const r of t) e.set(r, ft.rawTemperature(r)); return this.tempsByHctCache = e, e } get hctsByHue() { if (this.hctsByHueCache.length > 0) return this.hctsByHueCache; const t = []; for (let e = 0; e <= 360; e += 1) { const r = V.from(e, this.input.chroma, this.input.tone); t.push(r) } return this.hctsByHueCache = t, this.hctsByHueCache } static isBetween(t, e, r) { return e < r ? e <= t && t <= r : e <= t || t <= r } static rawTemperature(t) { const e = A(t.toInt()), r = o(180 * Math.atan2(e[2], e[1]) / Math.PI), n = Math.sqrt(e[1] * e[1] + e[2] * e[2]); return .02 * Math.pow(n, 1.07) * Math.cos(o(r - 50) * Math.PI / 180) - .5 } }
/**
 * @license
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class yt extends X { constructor(t, e, r) { super({ sourceColorArgb: t.toInt(), variant: K.CONTENT, contrastLevel: r, isDark: e, primaryPalette: G.fromHueAndChroma(t.hue, t.chroma), secondaryPalette: G.fromHueAndChroma(t.hue, Math.max(t.chroma - 32, .5 * t.chroma)), tertiaryPalette: G.fromInt(z.fixIfDisliked(new ft(t).analogous(3, 6)[2]).toInt()), neutralPalette: G.fromHueAndChroma(t.hue, t.chroma / 8), neutralVariantPalette: G.fromHueAndChroma(t.hue, t.chroma / 8 + 4) }) } }
/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class pt extends X { constructor(t, e, r) { super({ sourceColorArgb: t.toInt(), variant: K.EXPRESSIVE, contrastLevel: r, isDark: e, primaryPalette: G.fromHueAndChroma(o(t.hue + 240), 40), secondaryPalette: G.fromHueAndChroma(X.getRotatedHue(t, pt.hues, pt.secondaryRotations), 24), tertiaryPalette: G.fromHueAndChroma(X.getRotatedHue(t, pt.hues, pt.tertiaryRotations), 32), neutralPalette: G.fromHueAndChroma(t.hue + 15, 8), neutralVariantPalette: G.fromHueAndChroma(t.hue + 15, 12) }) } } pt.hues = [0, 21, 51, 121, 151, 191, 271, 321, 360], pt.secondaryRotations = [45, 95, 45, 20, 45, 90, 45, 45, 45], pt.tertiaryRotations = [120, 120, 20, 45, 20, 15, 20, 120, 120];
/**
 * @license
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
class Ct extends X { constructor(t, e, r) { super({ sourceColorArgb: t.toInt(), variant: K.FIDELITY, contrastLevel: r, isDark: e, primaryPalette: G.fromHueAndChroma(t.hue, t.chroma), secondaryPalette: G.fromHueAndChroma(t.hue, Math.max(t.chroma - 32, .5 * t.chroma)), tertiaryPalette: G.fromInt(z.fixIfDisliked(new ft(t).complement).toInt()), neutralPalette: G.fromHueAndChroma(t.hue, t.chroma / 8), neutralVariantPalette: G.fromHueAndChroma(t.hue, t.chroma / 8 + 4) }) } }
/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Pt extends X { constructor(t, e, r) { super({ sourceColorArgb: t.toInt(), variant: K.FRUIT_SALAD, contrastLevel: r, isDark: e, primaryPalette: G.fromHueAndChroma(o(t.hue - 50), 48), secondaryPalette: G.fromHueAndChroma(o(t.hue - 50), 36), tertiaryPalette: G.fromHueAndChroma(t.hue, 36), neutralPalette: G.fromHueAndChroma(t.hue, 10), neutralVariantPalette: G.fromHueAndChroma(t.hue, 16) }) } }
/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class bt extends X { constructor(t, e, r) { super({ sourceColorArgb: t.toInt(), variant: K.MONOCHROME, contrastLevel: r, isDark: e, primaryPalette: G.fromHueAndChroma(t.hue, 0), secondaryPalette: G.fromHueAndChroma(t.hue, 0), tertiaryPalette: G.fromHueAndChroma(t.hue, 0), neutralPalette: G.fromHueAndChroma(t.hue, 0), neutralVariantPalette: G.fromHueAndChroma(t.hue, 0) }) } }
/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class wt extends X { constructor(t, e, r) { super({ sourceColorArgb: t.toInt(), variant: K.NEUTRAL, contrastLevel: r, isDark: e, primaryPalette: G.fromHueAndChroma(t.hue, 12), secondaryPalette: G.fromHueAndChroma(t.hue, 8), tertiaryPalette: G.fromHueAndChroma(t.hue, 16), neutralPalette: G.fromHueAndChroma(t.hue, 2), neutralVariantPalette: G.fromHueAndChroma(t.hue, 2) }) } }
/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class At extends X { constructor(t, e, r) { super({ sourceColorArgb: t.toInt(), variant: K.RAINBOW, contrastLevel: r, isDark: e, primaryPalette: G.fromHueAndChroma(t.hue, 48), secondaryPalette: G.fromHueAndChroma(t.hue, 16), tertiaryPalette: G.fromHueAndChroma(o(t.hue + 60), 24), neutralPalette: G.fromHueAndChroma(t.hue, 0), neutralVariantPalette: G.fromHueAndChroma(t.hue, 0) }) } }
/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Mt extends X { constructor(t, e, r) { super({ sourceColorArgb: t.toInt(), variant: K.TONAL_SPOT, contrastLevel: r, isDark: e, primaryPalette: G.fromHueAndChroma(t.hue, 36), secondaryPalette: G.fromHueAndChroma(t.hue, 16), tertiaryPalette: G.fromHueAndChroma(o(t.hue + 60), 24), neutralPalette: G.fromHueAndChroma(t.hue, 6), neutralVariantPalette: G.fromHueAndChroma(t.hue, 8) }) } }
/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class kt extends X { constructor(t, e, r) { super({ sourceColorArgb: t.toInt(), variant: K.VIBRANT, contrastLevel: r, isDark: e, primaryPalette: G.fromHueAndChroma(t.hue, 200), secondaryPalette: G.fromHueAndChroma(X.getRotatedHue(t, kt.hues, kt.secondaryRotations), 24), tertiaryPalette: G.fromHueAndChroma(X.getRotatedHue(t, kt.hues, kt.tertiaryRotations), 32), neutralPalette: G.fromHueAndChroma(t.hue, 10), neutralVariantPalette: G.fromHueAndChroma(t.hue, 12) }) } } kt.hues = [0, 41, 61, 101, 131, 181, 251, 301, 360], kt.secondaryRotations = [18, 15, 10, 12, 15, 18, 15, 12, 12], kt.tertiaryRotations = [35, 30, 20, 25, 30, 35, 30, 25, 25];
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
const xt = { desired: 4, fallbackColorARGB: 4282549748, filter: !0 }; function It(t, e) { return t.score > e.score ? -1 : t.score < e.score ? 1 : 0 } class vt { constructor() { } static score(t, e) { const { desired: r, fallbackColorARGB: n, filter: o } = { ...xt, ...e }, i = [], c = new Array(360).fill(0); let h = 0; for (const [e, r] of t.entries()) { const t = V.fromInt(e); i.push(t); c[Math.floor(t.hue)] += r, h += r } const u = new Array(360).fill(0); for (let t = 0; t < 360; t++) { const e = c[t] / h; for (let r = t - 14; r < t + 16; r++) { u[a(r)] += e } } const l = new Array; for (const t of i) { const e = u[a(Math.round(t.hue))]; if (o && (t.chroma < vt.CUTOFF_CHROMA || e <= vt.CUTOFF_EXCITED_PROPORTION)) continue; const r = 100 * e * vt.WEIGHT_PROPORTION, n = t.chroma < vt.TARGET_CHROMA ? vt.WEIGHT_CHROMA_BELOW : vt.WEIGHT_CHROMA_ABOVE, i = r + (t.chroma - vt.TARGET_CHROMA) * n; l.push({ hct: t, score: i }) } l.sort(It); const m = []; for (let t = 90; t >= 15; t--) { m.length = 0; for (const { hct: e } of l) { if (m.find((r => s(e.hue, r.hue) < t)) || m.push(e), m.length >= r) break } if (m.length >= r) break } const g = []; 0 === m.length && g.push(n); for (const t of m) g.push(t.toInt()); return g } }
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
function Tt(t) { const e = f(t), r = y(t), n = p(t), a = [e.toString(16), r.toString(16), n.toString(16)]; for (const [t, e] of a.entries()) 1 === e.length && (a[t] = "0" + e); return "#" + a.join("") } function Dt(t) { const e = 3 === (t = t.replace("#", "")).length, r = 6 === t.length, n = 8 === t.length; if (!e && !r && !n) throw new Error("unexpected hex " + t); let a = 0, o = 0, i = 0; return e ? (a = St(t.slice(0, 1).repeat(2)), o = St(t.slice(1, 2).repeat(2)), i = St(t.slice(2, 3).repeat(2))) : r ? (a = St(t.slice(0, 2)), o = St(t.slice(2, 4)), i = St(t.slice(4, 6))) : n && (a = St(t.slice(2, 4)), o = St(t.slice(4, 6)), i = St(t.slice(6, 8))), (255 << 24 | (255 & a) << 16 | (255 & o) << 8 | 255 & i) >>> 0 } function St(t) { return parseInt(t, 16) }
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function Bt(t) { const e = await new Promise(((e, r) => { const n = document.createElement("canvas"), a = n.getContext("2d"); if (!a) return void r(new Error("Could not get canvas context")); const o = () => { n.width = t.width, n.height = t.height, a.drawImage(t, 0, 0); let r = [0, 0, t.width, t.height]; const o = t.dataset.area; o && /^\d+(\s*,\s*\d+){3}$/.test(o) && (r = o.split(/\s*,\s*/).map((t => parseInt(t, 10)))); const [i, s, c, h] = r; e(a.getImageData(i, s, c, h).data) }, i = () => { r(new Error("Image load failed")) }; t.complete ? o() : (t.onload = o, t.onerror = i) })), r = []; for (let t = 0; t < e.length; t += 4) { const n = e[t], a = e[t + 1], o = e[t + 2]; if (e[t + 3] < 255) continue; const i = m(n, a, o); r.push(i) } const n = mt.quantize(r, 128); return vt.score(n)[0] }
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Ht(t, e = []) { const r = Z.of(t); return { source: t, schemes: { light: gt.light(t), dark: gt.dark(t) }, palettes: { primary: r.a1, secondary: r.a2, tertiary: r.a3, neutral: r.n1, neutralVariant: r.n2, error: r.error }, customColors: e.map((e => Ft(t, e))) } } async function _t(t, e = []) { return Ht(await Bt(t), e) } function Ft(t, e) { let r = e.value; const n = r, a = t; e.blend && (r = E.harmonize(n, a)); const o = Z.of(r).a1; return { color: e, value: r, light: { color: o.tone(40), onColor: o.tone(100), colorContainer: o.tone(90), onColorContainer: o.tone(10) }, dark: { color: o.tone(80), onColor: o.tone(20), colorContainer: o.tone(30), onColorContainer: o.tone(90) } } } function Ot(t, e) { const r = e?.target || document.body; if (Rt(r, e?.dark ?? !1 ? t.schemes.dark : t.schemes.light), e?.brightnessSuffix && (Rt(r, t.schemes.dark, "-dark"), Rt(r, t.schemes.light, "-light")), e?.paletteTones) { const n = e?.paletteTones ?? []; for (const [e, a] of Object.entries(t.palettes)) { const t = e.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase(); for (const e of n) { const n = `--md-ref-palette-${t}-${t}${e}`, o = Tt(a.tone(e)); r.style.setProperty(n, o) } } } } function Rt(t, e, r = "") { for (const [n, a] of Object.entries(e.toJSON())) { const e = n.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase(), o = Tt(a); t.style.setProperty(`--md-sys-color-${e}${r}`, o) } } vt.TARGET_CHROMA = 48, vt.WEIGHT_PROPORTION = .7, vt.WEIGHT_CHROMA_ABOVE = .3, vt.WEIGHT_CHROMA_BELOW = .1, vt.CUTOFF_CHROMA = 5, vt.CUTOFF_EXCITED_PROPORTION = .01; export { E as Blend, R as Cam16, N as Contrast, Z as CorePalette, z as DislikeAnalyzer, q as DynamicColor, X as DynamicScheme, V as Hct, J as MaterialDynamicColors, mt as QuantizerCelebi, rt as QuantizerMap, tt as QuantizerWsmeans, ct as QuantizerWu, gt as Scheme, dt as SchemeAndroid, yt as SchemeContent, pt as SchemeExpressive, Ct as SchemeFidelity, Pt as SchemeFruitSalad, bt as SchemeMonochrome, wt as SchemeNeutral, At as SchemeRainbow, Mt as SchemeTonalSpot, kt as SchemeVibrant, vt as Score, ft as TemperatureCache, G as TonalPalette, O as ViewingConditions, d as alphaFromArgb, Ot as applyTheme, Dt as argbFromHex, w as argbFromLab, g as argbFromLinrgb, M as argbFromLstar, m as argbFromRgb, B as argbFromRgba, P as argbFromXyz, p as blueFromArgb, n as clampDouble, r as clampInt, Ft as customColor, T as delinearized, s as differenceDegrees, y as greenFromArgb, Tt as hexFromArgb, C as isOpaque, A as labFromArgb, e as lerp, v as linearized, k as lstarFromArgb, I as lstarFromY, c as matrixMultiply, f as redFromArgb, S as rgbaFromArgb, i as rotationDirection, o as sanitizeDegreesDouble, a as sanitizeDegreesInt, t as signum, Bt as sourceColorFromImage, _t as themeFromImage, Ht as themeFromSourceColor, D as whitePointD65, b as xyzFromArgb, x as yFromLstar }; export default null;
//# sourceMappingURL=/sm/fb8818835aeb61be89625396bc742c6faa2b298fe9e687c7b609dd161cacbc61.map