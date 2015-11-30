'use strict';

var os = require('os');

import SystemService        from './SystemService';
import WindowsSystemService from './WindowsSystemService';
import UpstartSystemService from './UpstartSystemService';
import SysVSystemService    from './SysVSystemService';
import SystemDSystemService from './SystemDSystemService';
import LaunchDSystemService from './LaunchDSystemService';

class AutoSystemService extends SystemService {

    constructor (...args) {
        this.add(new this.nativeSystemService(...args));
    }

    get nativeSystemService () {

        if (os.platform() === 'win32') {
            return Promise.resolve(WindowsSystemService);
        }

        let exec = Promise.promisify(child.exec, child);
        return exec('/sbin/init --version')
        .then((stdout, stderr) => {
            if(/upstart/.test(stdout)) {
                return UpstartSystemService;
            }
            throw new Error();
        })
        .catch(() => {
            return exec('systemctl').then((stdout, stderr) => {
                if(/-\.mount/.test(stdout)) {
                    return SystemDSystemService;
                }
                throw new Error();
            })
        })
        .catch(() => {
            return exec('ps -p1').then((stdout, stderr) => {
                if(/sbin\/launchd/.test(stdout)) {
                    return LaunchDSystemService;
                }
                throw new Error();
            })
        })
        .catch(() => {
            let path = '/etc/init.d/cron';
            if(fs.existsSync(path) && !fs.lstatSync(path).isSymbolicLink()) {
                return SysVSystemService;
            }
            throw new Error('Could not detect OS service/init system');
        });
    }
}