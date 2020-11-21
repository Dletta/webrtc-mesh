var Mesh = require('./streamIndex.js').Mesh;
var { Duplex } = require('stream');

var mesh = Mesh({
  url: 'wss://de.meething.space:443/',
  key: 'test',
  debug: false,
})

var meshStream = new Duplex({
  write(chunk, encoding, callback) {
    mesh.sendToAll(chunk);
    callback();
  },
  read() {
  },
})

mesh.pipe(meshStream.push.bind(meshStream))

process.stdin.pipe(meshStream).pipe(process.stdout);


setTimeout(mesh.printPeers, 2000);
