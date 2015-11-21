'use strict';

var cp = require('child_process');

import SpawnService from './SpawnService';

export default class ForkService extends SpawnService {

    spawn () {

        this.service = cp.fork(this.processPath, this.parsedArgs, {silent : this.silent});
        this.service.on('message', this.handleMessage.bind(this));
    }

    send (name, msg) {

        if (!this.started) {
            throw new Error(this.serviceName + ' has not yet been started.');
        }

        this.service.send({name: name, data: msg});
    }

    handleMessage (msg) {
        var name = msg.name;
        var data = msg.data;

        if (name.startsWith('Service.status.')) {
            if (!this.healthCheck) {
                this.warn('Unsolicited status received by', this.serviceName, msg);
            }

            else if (name === 'Service.status.pass') {
                this.healthCheck.resolve(data);
                delete this.healthCheck;
            }

            else if (name === 'Service.status.fail') {
                this.healthCheck.reject(data);
                delete this.healthCheck;
            }

            else {
                this.warn('Invalid Service.status message', msg);
            }
        } else {
            this.publish(msg.name, msg.data);
        }
    }

    checkHealth (timeout) {

        this.send('Service.health', {timeout: timeout});
        this.healthCheck = {};
        this.healthCheck.promise =
            new Promise((resolve, reject) => {
                this.time = Date.now();
                this.healthCheck.resolve = resolve;
                this.healthCheck.reject = reject;
            })
            .timeout(timeout);

        return Promise.join(
                Promise.try(this.health, null, this),
                this.healthCheck.promise
            ).catch(err => {
                return this.handleError(err);
            });
    }

    //Override these methods

    get processPath () {
        return __dirname + '/../services/' + this.serviceName + '.process.js';
    }
}
