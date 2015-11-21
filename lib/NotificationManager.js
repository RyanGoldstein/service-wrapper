class Notification {

    constructor (name, args, manager) {
        this.manager = manager;
        this.dispatcher = null;
        this.name = name;
        this.args = args;
        this.status = 0;
        this.pointer = 0;
        return this;
    }

    cancel () {
        this.name = '';
        this.status = 0;
        this.pointer = 0;
        this.dispatcher = null;
        this.manager.cancelNotification(this);
    }

    dispatch (obj) {
        this.status = 1;
        this.pointer = 0;
        this.dispatcher = obj;
        this.manager.publishNotification(this);
    }
}

class NotificationManager {

    constructor () {
        this.interests = {};
        this.pending = [];
    }

    notifyObjects (n) {

        var name,
            subs;

        let next = function () {

            if (n.status === 1 && n.pointer < subs.length) {

                return Promise.try(subs[n.pointer++], [].concat(n, n.args))
                    .then(function (response) {
                        n.response = response;
                        return next();
                    });
            }

            else {
                subs = null;
                if (n.status === 1) {
                    n.cancel();
                }

                return Promise.resolve(n.response);
            }
        };

        name = n.name;

        if (this.interests[name] && this.interests[name].length) {
            subs = this.interests[name].slice(0);
            return next();
        }

        else {
            let s = n.dispatcher.constructor.name + ' published \'' + n.name + '\' but there are no subscribers.';

            if (typeof n.dispatcher.log === 'function') {
                n.dispatcher.log('app', 'warn', s);
            }

            else {
                console.warn(s);
            }
        }
    }

    publishNotification (notification) {
        this.pending.push(notification);
        return this.notifyObjects(notification);
    }

    subscribe (name, fn, priority) {

        priority = isNaN(priority) ? -1 : priority;
        this.interests[name] = this.interests[name] || [];

        if (priority <= -1 || priority >= this.interests[name].length) {
            this.interests[name].push(fn);
        } else {
            this.interests[name].splice(priority, 0, fn);
        }

    }

    unsubscribe (name, fn) {
        var fnIndex = this.interests[name].indexOf(fn);
        if (fnIndex > -1) {
            this.interests[name].splice(fnIndex, 1);
        }
    }

    publish () {

        var notification,
            args = Array.prototype.slice.call(arguments),
            name = args[0],
            dispatcher = args[args.length - 1];

        args = args.slice(1, args.length - 1);
        notification = new Notification(name, args, this);
        notification.status = 1;
        notification.pointer = 0;
        notification.dispatcher = dispatcher;
        return this.publishNotification(notification);
    }

    cancelNotification (notification) {
        this.pending.splice(this.pending.indexOf(notification), 1);
        notification = null;
    }
}

export default new NotificationManager();