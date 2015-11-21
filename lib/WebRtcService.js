'use strict';

import Peer                 from '../lib/webrtc/Peer';
import Service              from '../core/Service';
import Binary               from '../lib/Binary';

export default class WebRTCService extends Service {

    constructor (opts) {
        super(opts);
    }

    _start () {
        this.peers = [];
        this.subscribe('WebRTC.sdpExchange', this.handleSdpExchange);
    }

    _stop () {
        this.peers.forEach(peer => {
            peer.close();
        });
        this.unsubscribe();
    }

    createPeer (user, data) {

        let offer = data.offer;

        let peer = new Peer({
            stunHost : data.stunHost,
            turnHost : data.turnHost,
            turnUsername : data.turnUsername,
            turnPassword : data.turnPassword
        });

        peer.user = user;

        peer.on('datachannel', channel => {
            if (/^(api)(_?)/.test(channel.label)) {
                this.registerApiChannel(channel);
            }
        });

        this.peers.push(peer);

        return new Promise((resolve, reject) => {
            setTimeout(() => {
                peer.createAnswer(offer).then(resolve).catch(reject);
            }, 500);
        });
    }

    registerApiChannel (channel) {

        let user = channel.peer.user;

        channel.on('message', data => {

            let msg = Binary.parseMessage(data);
            this.debug('received...', msg.header, msg.body);

            this.publish('ApiProxy.request', {
                path : msg.header.path,
                method : msg.header.method,
                body : msg.body,
                user : user
            }).then(response => {

                let header = {
                    type : 'response',
                    requestId : msg.header.requestId,
                    status : response.status
                };

                this.debug('sending...', msg.header, msg.body);

                channel.send(Binary.createMessage(header, response.body, true));

            }).catch(err => {

                let header = {
                    type : 'response',
                    requestId : msg.header.requestId,
                    status : 500
                };

                channel.send(Binary.createMessage(header, {error : err.message}));
            });
        });
    }

    handleSdpExchange (n, data) {

        let user = data.user || this.store.find('user', {'cloudAccount.cloudId' : data.userId});

        if (!user) {
            return Promise.reject(new Error('User not found on NVR.'));
        }

        this.debug('sdp exchange...', data);

        return this.createPeer(user, data);
    }
}
