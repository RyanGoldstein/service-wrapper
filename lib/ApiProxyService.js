'use strict';

var merge = require('merge'),
    path = require('path');

import Service          from '../core/Service';
import ProxyRequest     from '../api/ProxyRequest';
import ProxyResponse    from '../api/ProxyResponse';

export default class ApiProxyService extends Service {

    constructor (opts) {
        super(opts);
        this._routes = opts.routes || {};
    }

    _start () {

        this.subscribe('ApiProxy.request', this.handleProxyRequest);
        this.routes = {};

        for (let p in this._routes) {

            let tmp = this.parseRoute(path.join('/api', this.config.apiVersion, p));

            this.routes[p] = {
                regex : tmp[0],
                params : tmp[1],
                routes : this._routes[p]
            };
        }
    }

    _stop () {
        this.routes = {};
    }

    parseRoute (route) {

        var regex,
            params = [],
            strict = false,
            sensitive = false;

        if (route instanceof RegExp) {
            return [route, params];
        }

        if (route.indexOf('regex:') > -1) {
            // Convert to a regex and return...
            return [new RegExp(route.replace('regex:', '')), params];
        }

        if (route instanceof Array) {
            route = '(' + route.join('|') + ')';
        }

        route = route
            .concat(strict ? '' : '/?')
            .replace(/\/\(/g, '(?:/')
            .replace(/\+/g, '__plus__')
            .replace(/(\/)?(\.)?:(\w+)(?:(\(.*?\)))?(\?)?/g,
                function (_, slash, format, key, capture, optional) {
                    params.push({
                        name : key,
                        optional : !!optional
                    });
                    slash = slash || '';
                    return (
                        (optional ? '' : slash) +
                        '(?:' +
                        (optional ? slash : '') +
                        (format || '') + (capture || (format && '([^/.]+?)' || '([^/]+?)')) + ')' +
                        (optional || '')
                    );
                }
            )
            .replace(/([\/.])/g, '\\$1')
            .replace(/__plus__/g, '(.+)')
            .replace(/\*/g, '(.*)');

        regex = new RegExp('^' + route + '$', sensitive ? '' : 'i');
        return [regex, params];
    }

    parseParams (params, matches) {

        var vals = {};

        if (params.length && matches.length) {
            for (let i = 1; i < matches.length; i ++) {
                let param = params[i - 1];
                vals[param.name] = matches[i] || null;
            }
        }

        return vals;
    }

    getMatches (path, regex) {

        if (!path || !regex) {
            return null;
        }

        return regex.exec(path.split('?')[0]);
    }

    handleProxyRequest (n, data) {

        var req,
            res,
            path,
            method,
            matches;

        path = data.path;
        method = data.method.toLowerCase();

        return new Promise((resolve, reject) => {

            function sendCallback (status, type, body) {
                resolve({status, type, body});
            }

            res = new ProxyResponse(sendCallback);

            for (let p in this.routes) {

                let r = this.routes[p];

                if (path === p || !!(matches = this.getMatches(path, r.regex))) {

                    if (r.routes[method]) {

                        req = new ProxyRequest({
                            path :  path.split('?')[0],
                            params : this.parseParams(r.params, matches),
                            body : data.body,
                            user : data.user
                        });

                        r.routes[method](req, res);
                        return;
                    }
                }
            }

            res.status(404).send('Not Found');
        });
    }
}
