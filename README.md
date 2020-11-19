# webrtc-mesh

** BETA Release API in the work, Subject to Change **

## What does it do??

### Prerequisite Disclaimer

WebRTC allows direct communication between RTC capable Peers (usually browser to browser), thanks to the modern Robinhood Style of
Coding (aka take from the geniuses and give to the masses) we can make node talk to webRTC peers. (Shoutout to my dependency contributors @theturtle32, @markandrus and @modeswitch)

### The sauce

Using **your** websocket signaling server (echo server to all connected peers for sdp exchange) do automagically connect all clients running this lib with a network of datachannels

## API - Beta

### Initialize

```javascript
const Mesh = require('webrtc-mesh').Mesh;

var config = {
  url: 'wss:websocket.url.server:port/',
  key: 'appKey or Token for message filterin', //optional
}

var mesh = Mesh(config);

mesh.pipe( (ev) => { //handle incoming data
  console.log('we got some data from another peer', ev.data)
  });

mesh.sendToAll( arrayBuffer(12) ) // or even just 'string of Json'
```

### Utilities

```javascript
mesh.getPeerList() // returns a map of connected Peers with KEY: peerID Value: object with {status:connectionStatus, conn:reference to Peer Connection, channel: reference to data channel}
mesh.getPeer(peerId) // returns a specific peer from the map
mesh.getPeerId() //return your peerId
mesh.printPeers() // console print for quick check against connection status
mesh.sendToAll(buffer || blob || string) //send to all peers
mesh.onNewPeer( function ) // register a function to receive the 'onOpen' event of a new data channel (**not implemented yet**)
```
