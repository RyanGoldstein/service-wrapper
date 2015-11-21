'use strict';

var wrench = require('wrench'),
    utils = require('../lib/utils'),
    WebSocket = require('ws');

import CPService         from '../core/CPService';

export default class EvoStreamService extends CPService {

    get processArgs () {
        return ['./build/config/evostream/config.lua'];
    }

    get processPath () {
        return './node_modules/.bin/evostreamms';
    }

    constructor (opts) {

        super(opts);

        this.nvr = this.store.find('nvr', {});
        this.http = opts.httpServer;

        this.method = 'spawn';
    }

    start () {

        if (this.startPromise) {
            return this.startPromise();
        }

        wrench.rmdirSyncRecursive('./build/videos/temp', true);
        wrench.mkdirSyncRecursive('./build/videos/temp', parseInt('0755', 8));

        // Copy config dir to ./build
        wrench.mkdirSyncRecursive('./build/config/evostream');
        wrench.copyDirSyncRecursive('./config/evostream', './build/config/evostream', {
            forceDelete: true
        });

        this.rpcServer = new WebSocket.Server({
            server : this.http,
            path : '/ems'
        });

        this.rpcServer.on('connection', client => {

            this.rpcClient = client;

            this.rpcClient.onmessage = e => {

                let message = e.data;

                while (message.length >= 4) {

                    let l = message.readUInt32BE(0, true);

                    if (message.length < 4 + l) {
                        return;
                    }

                    this.handleRPCEvent(JSON.parse(message.slice(4, 4 + l).toString()));

                    message = message.slice(4 + l);
                }
            };
        });

        return super.start();
    }

    _start () {

        this.currentRequest = null;

        this.inStreams = {};
        this.ingestPoints = {};
        this.configIds = {};
        this.pendingSdps = {};

        this.subscribe('EMS.getIngestPoint', this.handleGetIngestPoint);
        this.subscribe('EMS.startRecording', this.handleStartRecording);
        this.subscribe('EMS.stopRecording', this.handleStopRecording);
        this.subscribe('EMS.createStreamAlias', this.handleCreateStreamAlias);

        this.subscribe('EMS.sdp.getOffer', this.handleSdpGetOffer);
        this.subscribe('EMS.sdp.getAnswer', this.handleSdpGetAnswer);
        this.subscribe('EMS.sdp.receiveAnswer', this.handleSdpReceiveAnswer);
    }

    _stop () {
        this.unsubscribe();
        this.currentRequest = null;

        this.inStreams = {};
        this.ingestPoints = {};
        this.configIds = {};

        if (this.rpcClient) {
            this.rpcClient.close();
        }

        if (this.rpcServer) {
            this.rpcServer.close();
        }

        this.rpcClient = null;
        this.rpcServer = null;
    }

    openCliConnection () {

        return new Promise((resolve, reject) => {

            if (this.cliConnection) {
                resolve(this.cliConnection);
                return;
            }

            let conn = new WebSocket('ws://localhost:' + this.config.ports.emsCLI + '/cli');
            conn.setMaxListeners(0);

            conn.onclose = () => {
                this.cliConnection = null;
            };

            conn.onopen = () => {
                this.cliConnection = conn;
                resolve(conn);
            };

            conn.onerror = e => {
                reject(e);
                //reject(new Error('WebSocket error.'));
            };
        });
    }

    cliRequest (command, params) {

        if (this.currentRequest) {
            this.currentRequest = this.currentRequest.then(() => this.cliRequest(command, params));
            return this.currentRequest;
        }

        this.currentRequest = new Promise((resolve, reject) => {

            var msg,
                req,
                buffer;

            msg = JSON.stringify({
                command : command,
                parameters : params
            });

            buffer = new Buffer(msg.length + 4);
            buffer.writeUInt32BE(msg.length, 0);
            buffer.write(msg, 4);

            this.openCliConnection().then(conn => {

                conn.onerror = e => {
                    reject(new Error('WebSocket error.'));
                };

                conn.onmessage = e => {

                    let response = e.data;

                    if (response.length >= 4) {

                        let l = response.readUInt32BE(0, true);

                        if (response.length < 4 + l) {
                            return;
                        }

                        response = JSON.parse(response.slice(4, 4 + l).toString());
                        resolve(response);
                        this.currentRequest = null;
                    }
                };

                conn.send(buffer);
            });
        });

        return this.currentRequest;
    }

    getIngestPoint (streamName) {

        if (!this.ingestPoints[streamName]) {

            this.ingestPoints[streamName] = utils.randomAlphaNumeric(16);

            return this.cliRequest('createIngestPoint', {
                privateStreamName : this.ingestPoints[streamName],
                publicStreamName : streamName
            }).return(this.ingestPoints[streamName]);

        }

        else {
            return Promise.resolve(this.ingestPoints[streamName]);
        }

    }

    startRecording (data) {

        var nvr = this.nvr;

        return this.cliRequest('record', data).then(response => {
            if (response.status === 'FAIL') {
                throw new Error(response.description);
            }
            return response.data.configId;
        });
    }

    stopRecording (configId) {

        return this.cliRequest('removeConfig', {
            id : configId,
            permanently : 1
        });
    }

    createStreamAlias (streamName, alias) {

        return this.cliRequest('addStreamAlias', {
            localStreamName: streamName,
            aliasName: alias
        }).then(response => {
            return response.data;
        });
    }

    removeStreamAlias (alias) {

        return this.cliRequest('removeStreamAlias', {
            aliasName: alias
        });
    }

    handleStartRecording (n, data) {
        return this.startRecording(data);
    }

    handleStopRecording (n, configId) {
        return this.stopRecording(configId);
    }

    handleCreateStreamAlias (n, data) {
        return this.createStreamAlias(data.streamName, data.alias);
    }

    handleGetIngestPoint (n, streamName) {
        return this.getIngestPoint(streamName);
    }

    handleSdpGetOffer (n, data) {
        return this.cliRequest('createWrtcAcceptor', {
            stunServerAddress : data.stunHost || null,
            turnServerAddress : data.turnHost || '',
            turnUsername : data.turnUsername || '',
            turnPassword : data.turnPassword || ''
        }).then(response => {

            let data = response.data;
            let deferred;

            let promise = new Promise((resolve, reject) => {
                this.pendingSdps[data.protocolId] = {resolve, reject, promise};
            });

            return promise;
        });
    }

    handleSdpGetAnswer (n, data) {

    }

    handleSdpReceiveAnswer (n, data) {
        return this.cliRequest('wrtcSdpAnswer', {
            sdpAnswer : data.answer,
            protocolId : data.protocolId
        }).then(response => {
            if (data.status === 'FAIL') {
                throw new Error(data.description);
            }
        });
    }

    handleRPCEvent (data) {

        var a,
            type,
            start,
            clock,
            params,
            payload;

        type = data.type;
        payload = data.payload;

        this.silly('RPC EVENT : ' + type, payload);

        switch (type) {

            case 'inStreamCreated' :
                this.publish('EMS.inStreamCreated', payload);
                this.publish('EMS.inStreamCreated.' + payload.name, payload);
                break;

            case 'inStreamClosed' :
                this.publish('EMS.inStreamClosed', payload);
                this.publish('EMS.inStreamClosed.' + payload.name, payload);
                break;

            case 'outStreamCreated' :
                this.publish('EMS.outStreamCreated', payload);
                break;

            case 'outStreamClosed' :
                this.publish('EMS.outStreamClosed', payload);
                break;

            case 'recordChunkClosed' :

                clock = payload.clockSync;
                params = payload.customCLIParameters;

                start = clock.wallClock + payload.segmentStartTs - (clock.streamClock + clock.streamClockBase);

                let segment = {
                    start           :   start,
                    offset          :   clock.segmentStartTs,
                    duration        :   payload.segmentDuration,
                    file            :   payload.file
                };

                for (let p in params) {
                    segment[p.substr(1)] = params[p];
                }

                this.publish('EMS.newSegment', segment);

                break;

            case 'wrtcSDPChanged' : {

                if (payload.complete) {

                    let promise = this.pendingSdps[payload.protocolId];

                    if (promise) {

                        this.pendingSdps[payload.protocolId] = null;

                        promise.resolve({
                            sdp : payload.sdp,
                            protocolId : payload.protocolId
                        });
                    }
                }

                break;
            }
        }
    }
}
