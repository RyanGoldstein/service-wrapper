var fs = require("fs"),
    path = require("path"),
    util = require("util"),
    child = require("child_process"),
    EventEmitter = require("events").EventEmitter,
    respawnInterval = 30,
    i = 0;

function canWrite(owner, inGroup, mode) {
  return owner && (mode & 00200) || // User is owner and owner can write.
    inGroup && (mode & 00020) || // User is in group and group can write.
    (mode & 00002); // Anyone can write.
}

module.exports = { 
  create: function create(name) {
    return new Service(name);
  }
}

var Service = function(name) {
  Service.super_.call(this);
  var self = this,
      dirname = path.dirname(require.main.filename),
      pwdStat = fs.statSync(dirname),
      isRoot = process.env["UID"] === "0" || process.env["USER"] === "root";
  if(!canWrite(process.getuid() === pwdStat.uid, process.getgid() === pwdStat.gid, pwdStat.mode)) {
    dirname = "/tmp";
  }
  this.name = name; 
  this.action = process.argv[2] || "debug";
  this.logFile = path.join(isRoot ? "/var/log" : dirname, name + ".log");
  this.pidFile = path.join(isRoot ? "/var/run" : dirname, name + ".pid");
  this.on("startProcess", this.onStartProcess);
  this.on("stopProcess", this.onStopProcess);
  this.on("init", this.onInit);
  this.on("reload", this.onReload);
  this.on("start", this.onStart);
  this.on("stop", this.onStop);
  setTimeout(function() {
    self.go();
  }, 0);
}

util.inherits(Service, EventEmitter);

Service.prototype.onInit = function onInit(err, data) {
  process.title = this.name;
  console.log("onInit");
}

Service.prototype.onStart = function onStart(err, data) {
  var self = this, stopping = false;
  this.handleSignals();
  this.setLogger(this.action);
  process.on("exit", function() {
    if(!stopping) {
      stopping = true;
      this.emit("stop", null, {}, function(err, data) {});
    }
  });
  if(!process.listeners("uncaughtException").length) {
    process.on("uncaughtException", function(err) {
      console.error("Uncaught exception, restarting", err.stack);
      this.emit("stop", null, {}, function(err, data) {
        this.emit("start", null, {}, function(err, data) {});
      });
    });
  }
}

Service.prototype.onStop = function onStop(err, data) {
  try {
    this.log.close(); 
  } catch(err) { }
}

Service.prototype.onReload = function onReload(err, data) {
}

Service.prototype.onStartProcess = function onStartProcess(err, data) {
  function spawn() {
    if(process.env.LAST_SPAWN > Date.now() - respawnInterval) {
      console.error("Process restarted within", respawnInterval, "seconds");
    } else {
      process.env.LAST_SPAWN = Date.now();
      console.info("Spawning process");
      try {
          var c = child.spawn(process.argv[0], [process.argv[1], "run"], { 
            env: process.env,
            detached: true,
            stdio: ["ignore", "ignore", "ignore"]
          });
      } catch(err) {
        console.error("Error spawning process");
      }
      try {
        fs.writeFileSync(this.pidFile, c.pid, {encoding: "utf8"});
      } catch(err) {
        console.error("Error writing pidFile", this.pidFile, c.pid);
      }
      try {
        c.unref();
      } catch(err) {
        console.error("Error unreferencing child process");
      }
    }
  }
  if(fs.existsSync(this.pidFile)) {
    try {
      var pid = parseInt(fs.readFileSync(this.pidFile, {encoding: "utf8"}));
      process.kill(pid, 0);
      console.error("Process already running with PID", pid, "from", this.pidFile);
      process.exit(1);
    } catch(err) {
      console.error("Orphaned PID file detected", err.message, err);
      spawn.call(this);
    }
  } else {
    spawn.call(this);
  }
}

Service.prototype.onStopProcess = function onStopProcess(err, data) {
  if(!arguments.callee.stopped) {
    arguments.callee.stopped = true;
    var pid;
    console.info("Getting PID");
    try { 
      pid = fs.readFileSync(this.pidFile, {encoding: "utf8"}); 
    } catch(err) { 
      console.info("No PID file found"); 
    }
    console.info("Unlinking PID file");
    try { 
      fs.unlinkSync(this.pidFile); 
    } catch(err) {}
    console.info("Stopping", this.name, "PID", pid);
    if(pid) {
      try { 
        process.kill(parseInt(pid)); 
      } catch(err) { 
        console.error("Error killing PID", pid); 
      }
    }
  }
}

Service.prototype.handleSignals = function handleSignals() {
  process.on("SIGUSR2", function() { 
    console.info("Received SIGUSR2 (Reload)"); 
    this.emit("reload", null, {}, function(err, data) {});
  });
  process.on("SIGINT", function() { 
    console.info("Received SIGINT"); 
    process.exit(); 
  });
  process.on("SIGTERM", function() { 
    console.info("Received SIGTERM"); 
    process.exit(); 
  });
}

Service.prototype.go = function go(action) {
  switch(action || this.action) {
    case "start":
      this.emit("startProcess", null, {}, function(err, data) {});
      break;
    case "stop":
      this.emit("stopProcess", null, {}, function(err, data) {});
      break;
    case "restart":
      this.emit("stopProcess", null, {}, function(err, data) {});
      this.emit("startProcess", null, {}, function(err, data) {});        
      break;
    case "reload":
      try {
        var pidStr = fs.readFileSync(this.pidFile, {encoding: "utf8"}),
            pid = parseInt(pidStr);
        if(isNaN(pid)) {
          throw new Error(pidStr + " is not an integer");
        } else {
          process.kill(pid, "SIGUSR2");
        }
      } catch(err) { 
        console.error("Unable to reload", err); 
      }
      break;
    case "install":
      if(process.env.USER == "root") {
        var initPath = path.join("/etc/init.d/", this.name),
            initScript = "#!/bin/bash\n# " + this.name + "\n# chkconfig:    35 95 5\n" + process.execPath + " " + process.argv[1] + " $@"
        console.info("Creating init script");
        fs.writeFileSync(initPath, initScript);
        console.info("Setting init script as executable");
        fs.chmodSync(initPath, 0755);
        console.info("Stopping service if it is running");
        this.emit("stopProcess", null, {}, function(err, data) {});
        console.info("Starting service");
        this.emit("startProcess", null, {}, function(err, data) {});
      } else {
        console.error("You must be root user to install a service");
      }
      break;
    case "uninstall":
      if(process.env.USER == "root") {
        try {
          fs.unlinkSync(path.join("/etc/init.d/", this.name));
        } catch(err) {}
      } else {
        console.error("You must be root user to uninstall a service");
      }
      break;
    case "service":
      console.log(this.name);
      break;
    case "debug":
      this.debug = true;
    case "run":
    default:
      this.emit("init", null, {}, function(err, data) {});
      this.emit("start", null, {}, function(err, data) {});
      break;
  }
}

Service.prototype.setLogger = function setLogger(action) {
  if(action == "debug") {
    //Log to console
    var l = console.log, i = console.info, e = console.error;
    console.log = function() { 
      l("L", new Date(), "[" + process.pid + ": " + process.title + "]", Array.prototype.join.call(arguments, " ")); 
    };
    console.info = function() { 
      i("I", new Date(), "[" + process.pid + ": " + process.title + "]", Array.prototype.join.call(arguments, " ")); 
    };
    console.error = function() { 
      if(arguments[0] instanceof Error) {
        e("E*" + new Date() + " [" + process.pid + ": " + process.title + "] " + arguments[0].message);
        e(arguments[0].stack);
      } else {
        e("E*" + new Date() + " [" + process.pid + ": " + process.title + "] " + Array.prototype.join.call(arguments, " ") + "\n");
      }
   };
  } else {
    //Log to file
    var self = this;
    this.log = fs.createWriteStream(this.logFile, {"flags": "a"});
    console.log = function() {
          self.log.write("L " + new Date() + " [" + process.pid + ": " + process.title + "] " + Array.prototype.join.call(arguments, " ") + "\n"); 
    };
    console.info = function() { 
    };
    console.error = function() { 
      if(arguments[0] instanceof Error) {
        self.log.write("E*" + new Date() + " [" + process.pid + ": " + process.title + "] " + arguments[0].message);
        self.log.write(arguments[0].stack);
      } else {
        self.log.write("E*" + new Date() + " [" + process.pid + ": " + process.title + "] " + Array.prototype.join.call(arguments, " ") + "\n");
      }
    };

    //Rolling log file
    setInterval(function() {
      if(!(Date.now() % 3600000))
      try {
        var stat = s.statSync(this.logFile), 
            now = new Date(), 
            dir = path.dirname(this.logFile), 
            base = path.basename(this.logFile, ".log");
        if(stat.mtime.getDate() != now.getDate() || 
           stat.mtime.getMonth() != now.getMonth() || 
           stat.mtime.getFullYear() != now.getFullYear()) {
          fs.renameSync(logfile, path.join(dir, 
                                           base + "-" + 
                                           stat.mtime.getFullYear() + "-" + 
                                           stat.mtime.getMonth() + "-" + 
                                           stat.mtime.getDate() + ".log"));
          var list = [],
              files = fs.readDirSync(), 
              pattern = new RegExp("(.+)(-\d{4}-\d{2}-\d{2}.log)");
          for(var i = 0; i < files.length; i++) {
            var m = pattern.exec(files[i]);
            if(base == m[1]) {
              list.push(m[0]);
            }
          }
          list.sort().reverse();
          for(var i = 30; i < list.length; i++) {
            fs.unlinkSync(path.join(dir, list[i]));
          }
        }
      } catch(err) {}
    }, 60 * 60 * 1000);
  }
}
