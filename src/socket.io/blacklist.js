var async = require('async');

var user = require('../user');
var meta = require('../meta');

var SocketBlacklist = module.exports;

SocketBlacklist.validate = (socket, data, callback) => {
	meta.blacklist.validate(data.rules, callback);
};

SocketBlacklist.save = (socket, rules, callback) => {
	async.waterfall([
		(next) => {
			user.isAdminOrGlobalMod(socket.uid, next);
		},
		(isAdminOrGlobalMod, next) => {
			if (!isAdminOrGlobalMod) {
				return callback(new Error('[[error:no-privileges]]'));
			}

			meta.blacklist.save(rules, next);
		},
	], callback);
};
