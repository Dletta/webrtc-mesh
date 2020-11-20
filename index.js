/* WEBRTC MESH Module

Author: Jachen Duschletta
October 2020 - COVID-19 Pandemic still ongoing

Topologies: Mesh 100%

Purpose: Using WebRTC create a datachannel layer between all peers
  connecting to the same signaling server.
  This may be your application server or a microservice.
  */

/* The idea is to announce yourself to any other peers and to listen
  to new arrivals. Once someone new arrives, we send them an offer to
  accept a data channel connection. After some back and forth, we are connected
  and can freely communicate without needing a server.
  (TURN servers are not currently supported )

  Some of this code is from Mozilla Developer Network, but the rest is mostly
  my own homegrown hacks over the webRTC API built into browsers */

const wrtc = require('wrtc');
const WebSocket = require('websocket').w3cwebsocket;
var RTCPeerConnection = wrtc.RTCPeerConnection;


exports.Mesh = function Mesh (config) {

  /* To identify yourself to the signaling server and to others
    We generate a random UUID as our peer ID.
    */
  const peerId = generatePID();
  const appKey = config.appKey || 'mesh';
  var debug = config.debug || false;
  var messageListener = [];
  var openListener = [];

  /* Globals for State Management */
  // map of PID containing status objects and connection reference, key = pid
  var peers = new Map();
  // queue of 'to connect to' peer ids (pid)
  var queue = [];

  /* We use UUID v4 algo for the uuid. */

  function generatePID () {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
     })
  }

  /* Then we connect to the websocket signaling server using the 'json' (string or binary both supported)
  */
  var ws = new WebSocket(config.url,'json')

  /* When the connection opens we want to broadcast ourselves to the other peers */

  ws.addEventListener('open', () => {
    // Announce your peer ID to all the peers
    var data = {
      broadcast: true,
      announce: true,
      from: peerId,
      msg: "I am " + peerId,
      key: appKey,
    }
    var msg = JSON.stringify(data);
    ws.send(msg)
  });

  /* The server will respond or send messages to our peer and we need to handle that
    Below function handles incoming messages. Each message type needs a slightly
    different handler.
    */

  ws.addEventListener('message', event => {
    //console.debug(event.data);
    // receive the data into an object
    var msg = JSON.parse(event.data);
    if (msg.from == peerId || msg.length == 0 || msg.dam || msg.key != appKey) { return; } //don't listen to yourself
    if(debug){console.log(msg.to, msg.to == peerId, msg);}
    // if we receive a peer announcement, add them to the list to try to connect to
    if (msg.announce) {
      if(debug){console.log('received announcement', msg);}
      if(msg.from == undefined) { return;}
      // add this new peer to our list of peers
      add(msg.from);
      connect();
    // if we receive an offer, let's handle it
    } else if (msg.offer) {
      if(msg.to == peerId){
        if(debug){console.log('received offer from ', msg.from, msg);}
        handleOffer(msg);
      }
    // if we receive an answer, let's handle it
    } else if (msg.answer) {
      if(msg.to == peerId) {
        if(debug){console.log('received answer from ', msg.from, msg);}
        handleAnswer(msg);
      }
    } else if (msg.candidate) {
      if(msg.to == peerId) {
        if(debug){console.log('received candidate from ', msg.from, msg);}
        handleCandidates(msg);
      }
    } else if (msg.left) {
      // remove this peer from our list
      config.leavehandler(msg.from);
      if(debug){console.log('removing', msg);}
      remove(msg.from);
    }
  });

  /* Define add and remove from the list */

  // add a new pid to the list of items
  function add (pid) {
    if(debug){console.log('called add');}
    // check if we already have this item
    var haveIt = peers.has(pid)
    if(debug){console.warn('we have this peer:', pid, haveIt);}
    if(!haveIt) {
      // add new peer
      peers.set(pid, {status:'new'});
      queue.push(pid);
    }
  }

  // remove a  pid from the list of items
  function remove (pid) {
    if(debug){console.log('called remove', pid);}
    // check if we already have this item
    var haveIt = peers.has(pid)
    if(haveIt) {
      var peer = peers.get(pid);
      peer.conn.close();
      peer.status = 'closed';
      if(debug){console.log('removed', pid);}
      // remove new peer
      peers.delete(pid);
    }
  }

  // send offers to connections
  function connect () {
    if(debug){console.log('called connect');}
    // loop over the queue of waiting peers and
    while (queue.length>0) {
      // TODO: Check if peer already exists before re-doing
      // for each peer get pid
      var pid = queue.shift();

      var peer = createRTC(pid);
      peers.status = 'connecting';
      // update status into map
      peers.set(pid, peer);
      if(debug){console.log("updated status for pid", pid);}

      // start connection
      connectRTC(pid, peer.conn)
    }
  }

  async function connectRTC (pid, pc) {
    if (debug) console.log('connecting to ', pid);
    // setup datachannel
    await setDataChannel(pc, pid)
    await createOffer(pc, pid)
  }

  /*
  create and set datachannel for this peer connection
  */

  async function setDataChannel (pc, pid) {
    if(debug){console.log("attempting connection to ", pid);}
    channel = await pc.createDataChannel('mesh');
    channel.binaryType = 'arraybuffer';

    channel.onmessage = handleDataChannelMessage;

    channel.onopen = handleDataChannelOpen;

    channel.onclose = handleDataChannelClose;

    if (debug) console.log('created data channel to', pid);
    // add it to peers info
    var peer = peers.get(pid);
    peer.channel = channel;
    peers.set(pid, peer);
  }

  /* Handle Data Channel Events (open, message, close etc)
      We need them again later
      */

  function handleDataChannelOpen (ev) {
    try {
      if(debug){console.log('channel opened', ev);}
      var data = {
        type: "handshake",
        data: peerId
      };
      var msg = JSON.stringify(data);
      channel.send(msg);
    } catch (e) {
      if(debug){console.log(e);}
    }
    openListener.forEach((item, i) => {
      item(ev)
    });

  }

  function handleDataChannelMessage (ev) {
    try{
      var msg = JSON.parse(ev.data);
      if(debug){console.warn('received MESSAGE=>:', msg);}
      if(msg.type == "handshake") {
        var pid = msg.data;
        var peer = peers.get(pid);
        peer.channel = channel;
        peer.status = 'connected';
        peers.set(pid, peer);
        return ;
      }
    } catch (e) {
      if(debug){console.log(e);}
    }

    messageListener.forEach((item, i) => {
      item(ev);
    });

  }

  function handleDataChannelClose (ev) {
    if (debug) console.log('channel closed', ev);
  }

  /* Create an offer for any peer that arrives after us
  */

  async function createOffer (pc, pid) {
    var offer = await pc.createOffer();
    var plain = JSON.stringify(offer);
    await pc.setLocalDescription(offer);
    if(debug){console.log('created Offer for ', pid, pc.signalingState);}
    var data = {
      broadcast:true,
      to: pid,
      from: peerId,
      offer: true,
      data: offer,
      key: appKey,
    };
    var msg = JSON.stringify(data);
    ws.send(msg)
  }

  /* When we receive an offer, let's handle it */

  async function handleOffer (msg) {
    //do we know the peer yet?
    if(peers.has(msg.from)) {
      var peer = peers.get(msg.from);
      var pc = peer.conn;
      var pid = msg.from; // the other guy
      //check if we already have a remote description
      if(debug){console.warn('received offer', msg, pc.currentRemoteDescription);}
      if(pc.currentRemoteDescription == null && msg.data != null && typeof msg.data == 'object') {
        await pc.setRemoteDescription(msg.data);
        if(debug){console.log('received Offer from other', pc.signalingState);}

        var answer = await pc.createAnswer();
        pc.setLocalDescription(answer);
        if(debug){console.log('create Answer', pc.signalingState);}
        var data = {
          broadcast:true,
          to: pid,
          from: peerId,
          answer: true,
          data: answer,
          key: appKey,
        };
        var msg = JSON.stringify(data);
        ws.send(msg)
      }

    } else {
      if(debug){console.log('create first for ', msg.from, msg);}
      // if we never met this guy, we need to first create a new connection for him
      add(msg.from);
      var peer = createRTC(msg.from);
      peers.set(msg.from, peer);
      handleOffer(msg);
    }
  }

  /* When we receive an answer we need to handle it */

  async function handleAnswer (msg) {
    var peer = peers.get(msg.from);
    var pc = peer.conn;
    var pid = msg.from;
    //check if we already have a remote description
    if(pc.currentRemoteDescription != null || msg.data == null) { return; }
    await pc.setRemoteDescription(msg.data);
    if(debug){console.log('set Answer to Remote Desc', pc.signalingState);}
  }

  /* When we receive candidates we need to handle them
  */

  async function handleCandidates (msg) {
    var peer = peers.get(msg.from);
    var pc = peer.conn;
    var pid = msg.from;
    if (msg.data != null && typeof msg.data == 'object'){
    	await pc.addIceCandidate(msg.data);
    	if(debug){console.log('added candidate ', pc.signalingState);}
    }
  }

  /* Create RTC connection */
  function createRTC (pid) {
    if(debug){console.log('creating rtc for ', pid);}
    // get status object
    var peer = peers.get(pid);
    // create peer connection
    var pc = new RTCPeerConnection({
          sdpSemantics: "unified-plan",
          iceCandidatePoolSize: 2,
          iceServers: [{
             urls: [
               "stun:stun.stunprotocol.org:3478",
               /*"stun:stun.l.google.com:19302",
               "stun:stun1.l.google.com:19302",
               "stun:stun2.l.google.com:19302",
               "stun:stun3.l.google.com:19302",
               "stun:stun4.l.google.com:19302",
               "stun:stun01.sipphone.com",
               "stun:stun.ekiga.net",
               "stun:stun.fwdnet.net",
               "stun:stun.ideasip.com",
               "stun:stun.iptel.org",
               "stun:stun.rixtelecom.se",
               "stun:stun.schlund.de",
               "stun:stunserver.org",
               "stun:stun.softjoys.com",
               "stun:stun.voiparound.com",
               "stun:stun.voipbuster.com",
               "stun:stun.voipstunt.com",
               "stun:stun.voxgratia.org",
               "stun:stun.xten.com",*/
             ]
           }
          ]
        });

    // update status
    peer.status = 'connecting';
    // add peer connection to status object
    peer.conn = pc;

    // setup listeners for pc, reuse from above for channels

    pc.ondatachannel = async function (e) {
      if (debug) console.log('received a datachannel', e);

      channel = e.channel;

      channel.binaryType = 'arraybuffer';

      channel.onmessage = handleDataChannelMessage;

      channel.onopen = handleDataChannelOpen;

      channel.onclose = handleDataChannelClose;

    };


    pc.onicecandidate = function (e) {
      //var can = JSON.stringify(e.candidate);
      var data = {
        broadcast: true,
        candidate: true,
        data: e.candidate,
        to: pid,
        from: peerId,
        key: appKey,
      }
      var msg = JSON.stringify(data);
      ws.send(msg)
    };

    pc.oniceconnectionstatechange = () => {
      if(debug){console.log('ice connection state', pc.iceConnectionState);}
      if (pc.iceConnectionState === "failed") {
        pc.restartIce();
      }
    };

    // update status into map
    peers.set(pid, peer);
    if(debug){console.log("updated status for pid", pid);}
    return peer;
  }


  return {
    /* Interface */

    getPeerList: () => {
      return peers;
    },

    printPeers: () => {
      console.warn('Printing Peers');
      peers.forEach((key, val)=>{console.warn(key, val)})
    },

    getPeer: (pid) => {
      return peers.get(pid);
    },

    getPeerId: () => {
      return peerId;
    },

    // send an object to all connected people
    sendToAll: (data) => {
      peers.forEach((item, i) => {
        if(item.channel.readyState == 'open') {
          item.channel.send(data);
        }
      });
    },

    onNewPeer: (cb) => {
      openListener.push(cb)
    },

    leave: () => {
      var data = {
        broadcast: true,
        left: true,
        from: peerId,
        msg: "bye from " + peerId,
        key: appKey,
      }
      var msg = JSON.stringify(data);
      ws.send(msg)
    },

    pipe: (cb) => {
      messageListener.push(cb)
    },

// to support piping into the stream we need below functions
    on: (eventName, cb) => {
      if(debug){console.log('on called', eventName, cb);}
    },

    once: (eventName, cb) => {
      if(debug){console.log('once called', eventName, cb);}
    },

    emit: (eventName, cb) => {
      if(debug){console.log('emit called', eventName, cb);}
    },

    write: (data) => {
      peers.forEach((item, i) => {
        if(item.channel.readyState == 'open') {
          item.channel.send(data);
        }
      });
    },

  }

}
