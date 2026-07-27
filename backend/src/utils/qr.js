// Minimal QR-Code SVG generator (ISO/IEC 18004 Mode 8-bit byte / L/M ECC)
// Zero-dependency implementation for generating QR codes offline.

const EXP_TABLE = new Array(256);
const LOG_TABLE = new Array(256);
for (let i = 0, val = 1; i < 256; i++) {
  EXP_TABLE[i] = val;
  LOG_TABLE[val] = i;
  val <<= 1;
  if (val & 256) val ^= 285;
}

function glog(n) { if (n < 1) throw new Error('glog(' + n + ')'); return LOG_TABLE[n]; }
function gexp(n) { while (n < 0) n += 255; while (n >= 256) n -= 255; return EXP_TABLE[n]; }

function Polynomial(num, shift) {
  let offset = 0;
  while (offset < num.length && num[offset] === 0) offset++;
  this.num = new Array(num.length - offset + shift);
  for (let i = 0; i < num.length - offset; i++) this.num[i] = num[i + offset];
  for (let i = num.length - offset; i < this.num.length; i++) this.num[i] = 0;
}
Polynomial.prototype = {
  get: function(i) { return this.num[i]; },
  getLength: function() { return this.num.length; },
  multiply: function(e) {
    const num = new Array(this.getLength() + e.getLength() - 1);
    for (let i = 0; i < this.getLength(); i++) {
      for (let j = 0; j < e.getLength(); j++) {
        num[i + j] ^= gexp(glog(this.get(i)) + glog(e.get(j)));
      }
    }
    return new Polynomial(num, 0);
  },
  mod: function(e) {
    if (this.getLength() - e.getLength() < 0) return this;
    const ratio = glog(this.get(0)) - glog(e.get(0));
    const num = new Array(this.getLength());
    for (let i = 0; i < this.getLength(); i++) num[i] = this.get(i);
    for (let i = 0; i < e.getLength(); i++) {
      num[i] ^= gexp(glog(e.get(i)) + ratio);
    }
    return new Polynomial(num, 0).mod(e);
  }
};

function rsPoly(ecLen) {
  let poly = new Polynomial([1], 0);
  for (let i = 0; i < ecLen; i++) {
    poly = poly.multiply(new Polynomial([1, gexp(i)], 0));
  }
  return poly;
}

// RS Blocks table for versions 1 to 10 (M level ECC)
const RS_BLOCKS_M = [
  [1, 16, 10], [1, 28, 16], [1, 44, 26], [2, 32, 18], [2, 43, 24],
  [4, 27, 16], [4, 31, 18], [2, 38, 22, 2, 39, 23], [3, 36, 22, 2, 37, 23], [4, 43, 26, 1, 44, 27]
];

function getRSBlocks(version) {
  const spec = RS_BLOCKS_M[version - 1];
  const list = [];
  for (let i = 0; i < spec.length; i += 3) {
    const count = spec[i], total = spec[i + 1], data = spec[i + 2];
    for (let j = 0; j < count; j++) list.push({ totalCount: total, dataCount: data });
  }
  return list;
}

function BitBuffer() { this.buffer = []; this.length = 0; }
BitBuffer.prototype = {
  get: function(index) { return ((this.buffer[Math.floor(index / 8)] >>> (7 - index % 8)) & 1) === 1; },
  put: function(num, length) {
    for (let i = 0; i < length; i++) {
      this.putBit(((num >>> (length - i - 1)) & 1) === 1);
    }
  },
  putBit: function(bit) {
    const bufIndex = Math.floor(this.length / 8);
    if (this.buffer.length <= bufIndex) this.buffer.push(0);
    if (bit) this.buffer[bufIndex] |= (0x80 >>> (this.length % 8));
    this.length++;
  }
};

function createQrMatrix(text) {
  const utf8 = unescape(encodeURIComponent(text));
  let version = 1;
  // Choose smallest version 1..10 that fits M level ECC
  const caps = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
  for (let v = 1; v <= 10; v++) {
    if (utf8.length <= caps[v - 1]) { version = v; break; }
  }
  if (utf8.length > caps[9]) version = 10; // clamp max version 10

  const rsBlocks = getRSBlocks(version);
  const bitBuf = new BitBuffer();
  bitBuf.put(0x04, 4); // Mode byte
  bitBuf.put(utf8.length, version <= 9 ? 8 : 16);
  for (let i = 0; i < utf8.length; i++) bitBuf.put(utf8.charCodeAt(i), 8);
  
  const totalDataBytes = rsBlocks.reduce((s, b) => s + b.dataCount, 0);
  const totalBits = totalDataBytes * 8;
  if (bitBuf.length + 4 <= totalBits) bitBuf.put(0, 4);
  while (bitBuf.length % 8 !== 0) bitBuf.putBit(false);
  while (bitBuf.buffer.length < totalDataBytes) {
    bitBuf.put(236, 8);
    if (bitBuf.buffer.length < totalDataBytes) bitBuf.put(17, 8);
  }

  const dcdata = bitBuf.buffer;
  let offset = 0;
  const dcList = [], ecList = [];
  let maxDc = 0, maxEc = 0;
  for (let i = 0; i < rsBlocks.length; i++) {
    const rcb = rsBlocks[i];
    const dc = dcdata.slice(offset, offset + rcb.dataCount);
    offset += rcb.dataCount;
    dcList.push(dc);
    const ecLen = rcb.totalCount - rcb.dataCount;
    const rs = rsPoly(ecLen);
    const mod = new Polynomial(dc, rs.getLength() - 1).mod(rs);
    const ec = new Array(ecLen);
    for (let j = 0; j < ecLen; j++) {
      const modIndex = j + mod.getLength() - ecLen;
      ec[j] = (modIndex >= 0) ? mod.get(modIndex) : 0;
    }
    ecList.push(ec);
    maxDc = Math.max(maxDc, dc.length);
    maxEc = Math.max(maxEc, ec.length);
  }

  const data = [];
  for (let i = 0; i < maxDc; i++) {
    for (let j = 0; j < dcList.length; j++) {
      if (i < dcList[j].length) data.push(dcList[j][i]);
    }
  }
  for (let i = 0; i < maxEc; i++) {
    for (let j = 0; j < ecList.length; j++) {
      if (i < ecList[j].length) data.push(ecList[j][i]);
    }
  }

  const size = version * 4 + 17;
  const modules = new Array(size);
  for (let i = 0; i < size; i++) modules[i] = new Array(size).fill(null);

  // Function to place position finder patterns
  function placeFinder(row, col) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        if (row + r <= -1 || size <= row + r || col + c <= -1 || size <= col + c) continue;
        const val = (0 <= r && r <= 6 && (c === 0 || c === 6)) ||
                    (0 <= c && c <= 6 && (r === 0 || r === 6)) ||
                    (2 <= r && r <= 4 && 2 <= c && c <= 4);
        modules[row + r][col + c] = val;
      }
    }
  }
  placeFinder(0, 0);
  placeFinder(size - 7, 0);
  placeFinder(0, size - 7);

  // Alignment pattern positions for versions >= 2
  const alignPos = [
    [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 52]
  ];
  if (version > 1) {
    const pos = alignPos[version - 1];
    for (let i = 0; i < pos.length; i++) {
      for (let j = 0; j < pos.length; j++) {
        const r = pos[i], c = pos[j];
        if (modules[r][c] !== null) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            modules[r + dr][c + dc] = dr === -2 || dr === 2 || dc === -2 || dc === 2 || (dr === 0 && dc === 0);
          }
        }
      }
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (modules[6][i] === null) modules[6][i] = (i % 2 === 0);
    if (modules[i][6] === null) modules[i][6] = (i % 2 === 0);
  }

  // Place data bits with mask 0 ((r+c)%2===0)
  let bitIdx = 0;
  let inc = -1;
  let row = size - 1;
  let col = size - 1;
  while (col > 0) {
    if (col === 6) col--;
    while (true) {
      for (let c = 0; c < 2; c++) {
        if (modules[row][col - c] === null) {
          let dark = false;
          if (bitIdx < data.length * 8) {
            dark = ((data[Math.floor(bitIdx / 8)] >>> (7 - bitIdx % 8)) & 1) === 1;
          }
          const mask = ((row + (col - c)) % 2 === 0);
          modules[row][col - c] = dark ^ mask;
          bitIdx++;
        }
      }
      row += inc;
      if (row < 0 || size <= row) {
        row -= inc;
        inc = -inc;
        col -= 2;
        break;
      }
    }
  }

  return { size, modules };
}

function generateQrSvg(text, margin = 2) {
  const { size, modules } = createQrMatrix(text);
  const fullSize = size + margin * 2;
  let path = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) {
        path += `M${c + margin},${r + margin}h1v1h-1z`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fullSize} ${fullSize}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#ffffff"/><path fill="#000000" d="${path}"/></svg>`;
}

module.exports = { generateQrSvg };
