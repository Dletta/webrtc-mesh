var Mesh = require('index.js').Mesh;

var mesh = exports.Mesh({
  url: 'wss://de.meething.space:443/',
  key: 'test',
  debug: false,
})

process.stdin.pipe(mesh);
mesh.pipe((ev)=>{console.log(ev)});
setTimeout(mesh.printPeers, 15000);
