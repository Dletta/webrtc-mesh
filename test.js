var Mesh = require('./index.js').Mesh;

var mesh = Mesh({
  url: 'wss://de.meething.space:443/',
  key: 'test',
  debug: false,
})

var meshedStream = mesh.getStream();
mesh.pipe(meshedStream.push.bind(meshedStream));
process.stdin.pipe(meshedStream).pipe(process.stdout);
mesh.data((ev)=>{console.log(ev.data)});
setTimeout(mesh.printPeers, 10000);
