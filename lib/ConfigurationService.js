'use strict';

import Service from './Service';

var yargs = require('yargs')
    .option('c', {alias: 'config', config: true})
    .option('v', {alias: 'version', describe: 'Version number'})
    .option('o', {
        alias: 'override',
        describe: 'Override config setting (-o key value)',
        nargs: 2,
        array: true
    })
    .wrap(110);

function set (obj, is, value) {
    if (typeof is === 'string') {
        return set(obj, is.split('.'), value);
    } else {
        if (is.length === 0) {
            return obj;
        } else {
            let prop = is[0];
            let existing = obj[prop];
            if (is.length === 1 && value !== undefined) {
                value = JSON.parse(value);
                if (typeof existing === 'object') {
                    value = merge(true, existing, value);
                }
                obj[prop] = value;
                return value;
            } else {
                if (!existing) {
                    obj[prop] = existing = {};
                }
                return set(existing, is.slice(1), value);
            }
        }
    }
}

class ConfigurationService extends Service {

    get name () {
        return 'config';
    }
    
    initialize () {

        let argv = yargs.argv;
        this.version = argv.version;

        for (let i in argv) {
            this[i] = argv[i];
        }

        if (argv.override) {
            for (let i = 0; i < argv.override.length; i += 2) {
                set(this, argv.override[i], argv.override[i + 1]);
            }
        }

    }
}