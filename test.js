var Mesh = require('./index.js').Mesh;

var mesh = Mesh({
  url: 'wss://de.meething.space:443/testme',
  key: 'testme',
  debug: true,
})

var meshedStream = mesh.getStream();
meshedStream.on('data', (data)=>{console.log('===============> received data:', data)})
mesh.pipe(meshedStream.push.bind(meshedStream));
process.stdin.pipe(meshedStream).pipe(process.stdout);
//mesh.data((ev)=>{console.log(ev.data)});
setTimeout(mesh.printPeers, 3000);
