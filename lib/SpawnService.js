'use strict';

var cp = require('child_process');

import Service from './Service';

export default class SpawnService extends Service {

    start () {

        if (this.started) {
            return this.started;
        }

        this.started = this.startDependencies()
            .then(() => {
                if (!this.silent) {
                    this.info(this.startMessage);
                }
            })
            .then(() => this.spawn())
            .delay(30)
            .then(() => this.initialize())
            .then(() => this.startChildren())
            .return(this);

        return this.started;
    }

    spawn () {

        this.service = cp.spawn(this.processPath, this.parsedArgs, {});
        if (!this.silent) {

            //todo: switch to process
            this.service.stderr.on('data', function (data) {
                // this.error(data.toString());
            });

            this.service.stdout.on('data', function (data) {
                // this.verbose(data.toString());
            });

        }

        this.service.on('exit', () => this.handleExit());
    }

    stop () {
        return this.stopChildren()
            .then(() => super.stop())
            .then(() => this.service.kill());
    }

    handleExit () {
        if (this.autoRestart) {
            return this.restart();
        }
    }

    checkHealth (timeout) {

        return Promise.try(this.health, null, this).catch(err => {
            return this.handleError(err);
        });
    }

    get parsedArgs () {
        let args = this.processArgs;
        let result = [];
        if (args instanceof Array) {
            result = args;
        } else if (typeof args === 'object') {
            for (let i in args) {
                result.push(i, args[i]);
            }
        } else {
            result.push(args);
        }
        return result;
    }

    //Override these methods

    get processArgs () {
    }

    get processPath () {
        throw new Error('SpawnService.processPath must be overriden');
    }

    get autoRestart () {
        return true;
    }

    health () {
        if (this.service) {
            this.service.kill(0);
        }
    }

}
