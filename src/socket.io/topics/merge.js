var async = require('async');
var topics = require('../../topics');
var privileges = require('../../privileges');

module.exports = (SocketTopics) => {
	SocketTopics.merge = (socket, tids, callback) => {
		if (!Array.isArray(tids)) {
			return callback(new Error('[[error:invalid-data]]'));
		}

		async.waterfall([
			(next) => {
				async.map(tids, (tid, next) => {
					privileges.topics.isAdminOrMod(tid, socket.uid, next);
				}, next);
			},
			(allowed, next) => {
				if (allowed.includes(false)) {
					return next(new Error('[[error:no-privileges]]'));
				}
				topics.merge(tids, socket.uid, next);
			},
		], callback);
	};
};
