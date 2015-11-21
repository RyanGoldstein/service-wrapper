'use strict';

var wrench = require('wrench'),
    merge = require('merge'),
    mongoose = require('mongoose');

export default class MongoService extends Service {

    get processArgs () {
        return ['--port', this.config.mongoPort,
            '--logpath', process.cwd() + '/' + this.config.logs.dir + '/mongo.log',
            '--dbpath', process.cwd() + '/' + this.config.dbPath];
    }

    get processPath () {
        return 'mongod';
    }

    constructor (opts) {

        super(opts);

        this.logFile = null;
        this.method = 'spawn';
        this.silent = true;
    }

    _start () {

        try {

            wrench.mkdirSyncRecursive(process.cwd() + '/' + this.config.dbPath, 0o755);

            let connString = 'mongodb://' + this.config.mongoHost + ':' + this.config.mongoPort + '/unicam';

            let checkStatus = (retryCount) => {

                return Promise.promisify(mongoose.connect, mongoose)(connString)
                    .catch(err => {
                        this.info(err.message, err.stack);
                        if (retryCount > 5) {
                            throw new Error('Couldn\'t connect to MongoDB after 3 tries... exiting');
                        }
                        return Promise.delay(retryCount + 1 || 1, 500).then(checkStatus);
                    })
                    .return(this);
            };

            return checkStatus();
        }

        catch (err) {
            return Promise.reject(err);
        }
    }

    _stop () {

    }
}
