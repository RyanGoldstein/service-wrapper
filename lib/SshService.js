'use strict';

var SSH = require('ssh2'),
    ps = require('promise-streams');

import Service          from '../core/Service';

export default class SSHService extends Service {

    constructor (opts) {
        super(opts);
    }

    _start () {
        this.connections = {};

        this.subscribe('SSH.open', this.handleOpen);
        this.subscribe('SSH.close', this.handleClose);
        this.subscribe('SSH.command', this.handleCommand);
        this.subscribe('SSH.upload', this.handleUpload);
        this.subscribe('SSH.download', this.handleDownload);
    }

    _stop () {
        this.closeAllConnections();
    }

    openConnection (host, port, username, password) {

        var p,
            conn;

        p = host + ':' + port;

        if (this.connections[p]) {
            return Promise.resolve(this.connections[p]);
        }

        return new Promise((resolve, reject) => {

            conn = new SSH();
            conn.on('error', reject);

            conn.on('ready', () => {
                this.info('SSH connection opened...' + p);
                this.connections[p] = conn;
                resolve(conn);
            });

            conn.on('close', () => {
                this.info('SSH connection closed...' + p);
                this.closeConnection(host, port);
            });

            conn.on('end', () => {
                this.info('SSH connection ended...' + p);
                this.closeConnection(host, port);
            });

            this.info('Connecting to %s@%s:%s', username, host, port);

            conn.connect({
                host : host,
                port : port,
                username : username,
                password : password
            });
        });
    }

    closeConnection (host, port) {

        var p,
            conn;

        p = host + ':' + port;
        conn = this.connections[p];

        if (conn) {
            conn.end();
            delete this.connections[p];
        }

        return Promise.resolve(conn);
    }

    closeAllConnections () {
        for (let p in this.connections) {
            let conn = this.connections[p];
            conn.end();
        }
        this.connections = {};
    }

    issueCommand (host, port, username, password, command) {

        return this.openConnection(host, port, username, password).then(conn => {
            return Promise.promisify(conn.exec, conn)(command);
        });
    }

    getSFTP (host, port, username, password) {
        return this.openConnection(host, port, username, password)
            .then(conn => Promise.promisify(conn.sftp, conn)());
    }

    get sftpOptions () {
        return {
            step: (transferred, chunk, total) => {
                if (this.transferred !== transferred) {
                    this.debug(
                        'SFTP upload: %s chunk size, %s transferred, %s total, %s left',
                        chunk,
                        transferred,
                        total,
                        total - transferred
                    );
                    this.transferred = transferred;
                }
            }
        };
    }

    uploadFile (host, port, username, password, remote, local) {

        this.info('Uploading file %s to %s:%s', local, host, remote);

        return this.getSFTP(host, port, username, password)
            .then(sftp => Promise.promisify(sftp.fastPut, sftp)(local, remote, this.sftpOptions));
    }

    downloadFile (host, port, username, password, remote, local) {

        this.info('Downloading file %s:%s to %s', host, remote, local);

        return this.getSFTP(host, port, username, password)
            .then(sftp => Promise.promisify(sftp.fastGet, sftp)(remote, local));
    }

    uploadStream (host, port, username, password, remote, readStream) {

        this.info('Uploading stream to %s:%s', host, remote);

        return this.getSFTP(host, port, username, password)
            .then(sftp => Promise.promisify(sftp.createWriteStream, sftp)(remote))
            .then(writeStream => ps.pipe(readStream, writeStream));
    }

    downloadStream (host, port, username, password, remote, writeStream) {

        this.info('Downloading %:%s to stream', host, remote);

        return this.getSFTP(host, port, username, password)
            .then(sftp => Promise.promisify(sftp.createReadStream, sftp)(remote))
            .then(readStream => ps.pipe(readStream, writeStream));
    }

    handleOpen (n, data) {

        var host = data.host,
            port = data.port || 22,
            username = data.username,
            password = data.password;

        return this.openConnection(host, port, username, password);
    }

    handleClose (n, data) {
        return this.closeConnection(data.host, data.port);
    }

    handleCommand (n, data) {
        var cmd = data.command,
            host = data.host,
            port = data.port || 22,
            username = data.username,
            password = data.password;

        return this.issueCommand(host, port, username, password, cmd).then((response) => {

            if (data.autoClose) {
                return this.closeConnection(host, port);
            }

            return response;
        });
    }

    handleUpload (n, data) {
        var local = data.local,
            remote = data.remote,
            host = data.host,
            port = data.port || 22,
            username = data.username,
            password = data.password,
            source = typeof local === 'string' ? 'File' : 'Stream';

        return this['upload' + source](host, port, username, password, remote, local).then(response => {

            if (data.autoClose) {
                return this.closeConnection(host, port);
            }

            return response;
        }).catch(err => {
            this.error(err);
        });
    }

    handleDownload (n, data) {
        var local = data.local,
            remote = data.remote,
            host = data.host,
            port = data.port || 22,
            username = data.username,
            password = data.password,
            source = typeof local === 'string' ? 'File' : 'Stream';

        return this['download' + source](host, port, username, password, remote, local).then(response => {

            if (data.autoClose) {
                return this.closeConnection(host, port);
            }

            return response;
        }).catch(err => {
            this.error(err);
        });
    }
}
