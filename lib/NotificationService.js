'use strict';

import Service                  from '../core/Service';

export default class NotificationService extends Service {

    constructor (opts) {

        super(opts);

        this.subscribe('Camera.motion.start', this.handleMotionStarted);
        this.subscribe('Camera.disconnected', this.handleCameraDisconnected);

    }

    handleMotionStarted (n, camera) {

        this.store.all('user').forEach(user => {
            if (user.areEmailAlertsEnabled) {
                this.notify('motion', user, camera);
            }
        });

    }

    handleCameraDisconnected (n, camera) {

        this.store.all('user').forEach(user => {
            if (user.areEmailAlertsEnabled) {
                this.notify('disconnected', user, camera);
            }
        });

    }

    notify (alert, user, camera) {
        var notifications = SchedulesController.activeNotifications(alert, user);
        notifications.forEach(notification => {
            switch (notification) {
                case 'email':
                    break;
                case 'push':
                    break;
            }
        });
    }
}
