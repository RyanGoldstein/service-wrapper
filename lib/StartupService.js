'use strict';

var cp = require('child_process'),
    instances = [];

import Service from './Service';

global.Promise = require('bluebird');

export default class StartupService extends Service {

    constructor () {

        super();

        this.autoStart = true;
        this.healthCheckInterval = 5000;
        this.healthCheckTimeout = 3000;
        this.parent = {children:{}};

        if (process.send) {
            process.on('message', this.handleMessage.bind(this));
        }

        process.on('exit', () => {
            this.stop().catch(err => {
                this.error(err);
            });
        });

        process.on('SIGINT', () => {
            process.exit(2);
        });

        process.on('uncaughtException', err => this.handleError(err));
    }

    send (name, msg) {
        if (!process.send) {
            throw new Error('No IPC channel for this process');
        }
        process.send({name: name, data: msg});
    }

    handleMessage (msg, handle) {

        if (msg.name === 'Service.health') {

            let timeout = (msg.data.timeout || 1000) - 10;

            this.checkHealth(timeout)
                .timeout(timeout)
                .then(() => {
                    this.send('Service.status.pass', true);
                })
                .catch(err => {
                    this.send('Service.status.fail', {message: err.message, stack: err.stack});
                });
        }

        else {
            this.publish(msg.name, msg.data);
        }
    }

    startMonitor () {
        if (this.monitor) {
            return;
        }
        this.monitor = setInterval(() => {
            this.checkHealth(this.healthCheckTimeout)
                .then(() => {
                    this.verbose('Health check for %s passed', this.serviceName);
                })
                .catch(err => {
                    this.error('Health check for %s failed\n', this.serviceName, err.stack);
                });
        }, this.healthCheckInterval);
    }

    stopMonitor () {
        if (this.monitor) {
            clearInterval(this.monitor);
            delete this.monitor;
        }
    }
}

//If this is imported into the module called by the command line
if (module.parent === require.main) {
    process.nextTick(() => {

        let service = require.main.exports;

        if (!(service instanceof Service)) {
            throw new Error('Main module is not exporting a Service: ' + require.main.filename);
        }

        if (service.autoStart) {

            service.start();

            //If not a child of another process with IPC
            if (!process.send) {
                service.startMonitor();
            }
        }
    });
}

