// Minimal THREE mock for testing
module.exports = {
  Vector3: jest.fn(function(x, y, z) {
    this.x = x || 0;
    this.y = y || 0;
    this.z = z || 0;
    this.lengthSq = jest.fn(() => this.x*this.x + this.y*this.y + this.z*this.z);
    this.length = jest.fn(() => Math.sqrt(this.lengthSq()));
    this.normalize = jest.fn(function() { 
      const len = this.length();
      if (len > 0) {
        this.x /= len;
        this.y /= len;
        this.z /= len;
      }
      return this; 
    });
    this.clone = jest.fn(function() { return new THREE.Vector3(this.x, this.y, this.z); });
    this.copy = jest.fn(function(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; });
    this.set = jest.fn(function(x, y, z) { this.x = x; this.y = y; this.z = z; return this; });
    this.add = jest.fn(function(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; });
  }),
  Quaternion: jest.fn(function(x, y, z, w) {
    this.x = x || 0;
    this.y = y || 0;
    this.z = z || 0;
    this.w = w !== undefined ? w : 1;
    this.clone = jest.fn(function() { return new THREE.Quaternion(this.x, this.y, this.z, this.w); });
  }),
  Raycaster: jest.fn(function() {
    this.firstHitOnly = false;
  }),
  SphereGeometry: jest.fn(),
};
