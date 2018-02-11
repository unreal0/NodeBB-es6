var async = require('async');
var winston = require('winston');
var validator = require('validator');

var db = require('../database');
var plugins = require('../plugins');

module.exports = (User) => {
	User.logIP = (uid, ip, callback) => {
		var now = Date.now();
		async.waterfall([
			(next) => {
				db.sortedSetAdd('uid:' + uid + ':ip', now, ip || 'Unknown', next);
			},
			(next) => {
				if (ip) {
					db.sortedSetAdd('ip:' + ip + ':uid', now, uid, next);
				} else {
					next();
				}
			},
		], callback);
	};

	User.getIPs = (uid, stop, callback) => {
		async.waterfall([
			(next) => {
				db.getSortedSetRevRange('uid:' + uid + ':ip', 0, stop, next);
			},
			(ips, next) => {
				ips = ips.map(ip =>
					validator.escape(String(ip))
				);
				next(null, ips);
			},
		], callback);
	};

	User.getUsersCSV = (callback) => {
		winston.verbose('[user/getUsersCSV] Compiling User CSV data');
		var csvContent = '';
		var uids;
		async.waterfall([
			(next) => {
				db.getSortedSetRangeWithScores('username:uid', 0, -1, next);
			},
			(users, next) => {
				uids = users.map(user => user.score);
				plugins.fireHook('filter:user.csvFields', { fields: ['uid', 'email', 'username'] }, next);
			},
			(data, next) => {
				User.getUsersFields(uids, data.fields, next);
			},
			(usersData, next) => {
				usersData.forEach((user) => {
					if (user) {
						csvContent += user.email + ',' + user.username + ',' + user.uid + '\n';
					}
				});

				next(null, csvContent);
			},
		], callback);
	};
};
