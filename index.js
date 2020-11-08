/*
webRTC-mesh by Jachen Duschletta 2020
v 0.1.0

Purpose: Using WebRTC create a datachannel layer between all peers
  connecting to the same signaling server.
  This may be your application server or a microservice.

Below export returns an object constructor to create a new mesh interface.

It expects that you provide a websocket signaling server (other options on the
 roadmap). When the client joins, it will wait to receive offers from other peers.
 Each peer receives it's own RTCPeerConnection and Datachannel, with an interface
 to talk to each of them individually or broadcast to all of them.

Once connected, it is up to you to add handlers for app logic etc. The provided
  key / appKey is added to our peerId (uuidv4) to help others identify whether
  they should connect to us. Leaving it empty will assume any connections are wanted.
  (This is optional and is only there to offer apps to 'subscribe' to only a
  set of data or part of the mesh if wanted or to allow one signaler to handle
  multiple applications)

*/

const Websocket = require('websocket')

modules.exports.wmesh = exports.wmesh = (function() {
  'use strict';
  var self;

  /* The idea is to announce yourself to any other peers and to listen
    to new arrivals. Once someone new arrives, we send them an offer to
    accept a data channel connection. After some back and forth, we are connected
    and can freely communicate without needing a server.
    (TURN servers are not currently supported )
    */

  class wmesh {
    constructor(config) {
      self = this;
      if(!config.url) {throw 'A signal server must be provided for the mesh to be built.'};
      this.server = config.url || '';
      this.appKey = config.key || {};
      /* To identify yourself to the signaling server and to others
        We generate a random UUID as our peer ID.
        At a later stage a token can be added (TODO ) to allow the signal server to
        reject or accept based on the token.
        */
      this.peerId = this.generatePID();
    }

    connectToSignaler () {
      var ws = new WebSocket('wss://' + this.server + '/','json')

      /* When the connection opens we want to broadcast ourselves to the other peers */

      ws.addEventListener('open', () => {
        // Announce your peer ID to all the peers
        var data = {
          broadcast: true,
          announce: true,
          pid: peerId,
          msg: "I am " + peerId,
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
        // if this is the server asking for a handshake, respond with our id
        if(msg.handshake) {
          var data = {
            handshake: true,
            pid: peerId
          }
          var msg = JSON.stringify(data);
          ws.send(msg)
        // if we receive a peer announcement, add them to the list to try to connect to
        } else if (msg.announce) {
          // making sure this isn't just us
          if (msg.pid != peerId) {
            // add this new peer to our list of peers
            add(msg.pid);
            connect();
          } else if (msg.left) {
            // remove this peer from our list
            remove(msg.pid);
          }
        // if we receive an offer, let's handle it
        } else if (msg.offer) {
          handleOffer(msg);
        // if we receive an answer, let's handle it
        } else if (msg.answer) {
          handleAnswer(msg);
        } else if (msg.candidate) {
          handleCandidates(msg);
        }
      });

      /* Define add and remove from the list */

      // add a new pid to the list of items
      function add (pid) {
        console.log('called add');
        // check if we already have this item
        var haveIt = peers.has(pid)
        console.warn('we have this peer:', pid, haveIt);
        if(!haveIt) {
          // add new peer
          peers.set(pid, {status:'new'});
          queue.push(pid);
        }
      }

      // remove a  pid from the list of items
      function remove (pid) {
        console.log('called remove');
        // check if we already have this item
        var haveIt = peers.has(pid)
        if(haveIt) {
          // remove new peer
          peers.delete(pid);
        }
      }

      // send offers to connections
      function connect () {
        console.log('called connect');
        // loop over the queue of waiting peers and
        while (queue.length>0) {
          // TODO: Check if peer already exists before re-doing
          // for each peer get pid
          var pid = queue.shift();

          var peer = createRTC(pid);
          peers.status = 'connecting';
          // update status into map
          peers.set(pid, peer);
          console.log("updated status for pid", pid);

          // start connection
          connectRTC(pid, peer.conn)
        }
      }

      async function connectRTC (pid, pc) {
        // setup datachannel
        await setDataChannel(pc, pid)
        await createOffer(pc, pid)
      }

      /*
      create and set datachannel for this peer connection
      */

      async function setDataChannel (pc, pid) {
        console.log("attempting connection to ", pid);
        channel = await pc.createDataChannel('mesh');

        channel.onmessage = handleDataChannelMessage;

        channel.onopen = handleDataChannelOpen;

        channel.onclose = handleDataChannelClose;

        console.log('created data channel');
        // add it to peers info
        var peer = peers.get(pid);
        peer.channel = channel;
        peers.set(pid, peer);
      }

      /* Handle Data Channel Events (open, message, close etc)
          We need them again later
          */

      function handleDataChannelOpen (ev) {
        //console.log('channel opened', ev);
        var data = {
          type: "handshake",
          data: peerId
        };
        var msg = JSON.stringify(data);
        channel.send(msg);
      }

      function handleDataChannelMessage (msg) {
        var msg = JSON.parse(msg.data);
        console.info('received MESSAGE=>:', msg, channel, self, this);
        if(msg.type == "handshake") {
          var pid = msg.data;
          var peer = peers.get(pid);
          peer.channel = channel;
          peer.status = 'connected';
          peers.set(pid, peer);
        }
      }

      function handleDataChannelClose (ev) {
        console.log('channel closed', ev);
      }

      /* Create an offer for any peer that arrives after us
      */

      async function createOffer (pc, pid) {
        var offer = await pc.createOffer();
        var plain = JSON.stringify(offer);
        document.getElementById('offerText').value = plain;
        await pc.setLocalDescription(offer);
        document.getElementById('status').value = pc.signalingState;
        console.log('created Offer for ', pid, pc.signalingState);
        var data = {
          direct:true,
          to: pid,
          from: peerId,
          offer: true,
          data: offer
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
          await pc.setRemoteDescription(msg.data);
          document.getElementById('status').value = pc.signalingState
          console.log('received Offer from other', pc.signalingState);

          var answer = await pc.createAnswer();
          pc.setLocalDescription(answer);
          document.getElementById('answerText').value = JSON.stringify(answer);
          document.getElementById('status').value = pc.signalingState
          console.log('create Answer', pc.signalingState);
          var data = {
            direct:true,
            to: pid,
            from: peerId,
            answer: true,
            data: answer
          };
          var msg = JSON.stringify(data);
          ws.send(msg)

        } else {
          console.log('create first for ', msg.from, msg);
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
        await pc.setRemoteDescription(msg.data);
        document.getElementById('status').value = pc.signalingState
        console.log('set Answer to Remote Desc', pc.signalingState);
      }

      /* When we receive candidates we need to handle them
      */

      async function handleCandidates (msg) {
        var peer = peers.get(msg.from);
        var pc = peer.conn;
        var pid = msg.from;
        await pc.addIceCandidate(msg.data);
        document.getElementById('status').value = pc.signalingState
        console.log('added candidate ', pc.signalingState);
      }

      /* Create RTC connection */
      function createRTC (pid) {
        console.log('creating rtc for ', pid);
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
          console.log('received a datachannel', e);

          channel = e.channel;

          channel.onmessage = handleDataChannelMessage;

          channel.onopen = handleDataChannelOpen;

          channel.onclose = handleDataChannelClose;

        };


        pc.onicecandidate = function (e) {
          //var can = JSON.stringify(e.candidate);
          var data = {
            direct: true,
            candidate: true,
            data: e.candidate,
            to: pid,
            from: peerId
          }
          var msg = JSON.stringify(data);
          ws.send(msg)
        };

        pc.oniceconnectionstatechange = () => {
          console.log('ice connection state', pc.iceConnectionState);
          document.getElementById('status').value = pc.iceConnectionState;
          if (pc.iceConnectionState === "failed") {
            pc.restartIce();
          }
        };

        // update status into map
        peers.set(pid, peer);
        console.log("updated status for pid", pid);
        printPeers();
        return peer;
      }

      // Helper, when we reach a timeout, we can try to query for the peer list

      function getPeerList () {
        var data = {
          peerlist: true,
          pid: peerId,
        }
        var msg = JSON.stringify(data);
        ws.send(msg)
      }

      function printPeers () {
        console.warn('Printing Peers');
        peers.forEach((key, val)=>{console.warn(key, val)})
      }

    }

    generatePID () {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
       })
    }



  }

  return wmesh;
}());
