var async = require('async');

var user = require('../../user');
var websockets = require('../index');

module.exports = (SocketUser) => {
	SocketUser.checkStatus = (socket, uid, callback) => {
		if (!socket.uid) {
			return callback(new Error('[[error:invalid-uid]]'));
		}
		async.waterfall([
			(next) => {
				user.getUserFields(uid, ['lastonline', 'status'], next);
			},
			(userData, next) => {
				next(null, user.getStatus(userData));
			},
		], callback);
	};

	SocketUser.setStatus = (socket, status, callback) => {
		if (!socket.uid) {
			return callback(new Error('[[error:invalid-uid]]'));
		}

		var allowedStatus = ['online', 'offline', 'dnd', 'away'];
		if (allowedStatus.indexOf(status) === -1) {
			return callback(new Error('[[error:invalid-user-status]]'));
		}

		var data = { status: status };
		if (status !== 'offline') {
			data.lastonline = Date.now();
		}

		async.waterfall([
			(next) => {
				user.setUserFields(socket.uid, data, next);
			},
			(next) => {
				var data = {
					uid: socket.uid,
					status: status,
				};
				websockets.server.emit('event:user_status_change', data);
				next(null, data);
			},
		], callback);
	};
};
