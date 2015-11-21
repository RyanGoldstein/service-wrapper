'use strict';

import Class        from './Class';

export default class Service extends Class {

    constructor () {
        super();
        this.serviceName    = this.constructor.name;
        this.children       = {};
        this.dependencies   = {};
        this.started        = null;
        this.silent         = false;
    }

    addChild (service, ...dependencies) {

        this.children[service.serviceName] = service;
        service.parent = this;
        service.addDependency(...dependencies);

    }

    addDependency (...dependencies) {

        dependencies.forEach(dep => {
            if (dep instanceof Service) {
                this.dependencies[dep.serviceName] = dep;
            } else if (typeof dep === 'string') {
                this.dependencies[dep] = this.children[dep];
            }
        });

    }

    get siblings () {
        let result = {};
        for (let i in this.parent.children) {
            let service = this.parent.children[i];
            if (i !== this.serviceName) {
                result[i] = service;
            }
        }
        return result;
    }

    get descendents () {
        let result = [];
        (function recurse (service) {
            for (let i in service.children) {
                let child = service.children[i];
                result.push(child);
                recurse(child);
            }
        })(this);
        return result;
    }

    startDependencies () {
        var deps = [];
        for (let i in this.dependencies) {
            let dep = this.dependencies[i];
            if (!(dep instanceof Service)) {
                this.dependencies[i] = dep = this.siblings[i];
                if (!(dep instanceof Service)) {
                    throw new Error('Dependency ' + i  + ' is not a sibling of ' +  this.serviceName);
                }
            }
            deps.push(dep.start());
        }
        return Promise.all(deps);
    }

    start () {

        if (this.started) {
            return this.started;
        }

        this.started = this.startDependencies()
            .then(() => Promise.try(this.initialize, null, this))
            .then(() => {
                if (!this.silent) {
                    this.info(this.startMessage);
                }
            })
            .then(() => this.startChildren())
            .return(this);
        return this.started;
    }

    stop () {

        if (!this.started) {
            return Promise.resolve(this);
        }

        return this.started
            .then(() => this.stopChildren())
            .then(Promise.try(this.destroy, null, this))
            .then(() => {
                this.started = null;

                try {
                    this.unsubscribe();
                } catch (err) { }

            }).return(this);
    }

    startChildren () {
        let children = [];
        for (let i in this.children) {
            children.push(this.children[i].start());
        }
        return Promise.all(children);
    }

    stopChildren () {
        let promises = [];
        for (let i in this.children) {
            promises.push(this.children[i].stop());
        }
        return Promise.all(promises);
    }

    checkHealth (timeout) {
        let promises = [Promise.try(this.health, null, this)];
        for (let i in this.children) {
            promises.push(this.children[i].checkHealth(timeout));
        }
        return Promise.all(promises).catch((err) => {
            return this.handleError(err);
        });
    }

    handleError (err) {
        return Promise.try(this.recover, [err], this).then(handled => {
            if (handled !== true) {
                throw err;
            }
        });
    }

    //Override these methods only, do not call directly

    get startMessage () {
        return 'Starting ' + this.serviceName + '...';
    }

    initialize () {
    }

    destroy () {
    }

    health () {
    }

    recover (err) {
    }

    restart () {
        return this.stop().then(() => this.start());
    }
}