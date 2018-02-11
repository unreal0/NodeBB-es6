var async = require('async');
var db = require('../database');

module.exports = (Messaging) => {
	Messaging.deleteMessage = (mid, roomId, callback) => {
		async.waterfall([
			(next) => {
				Messaging.getUidsInRoom(roomId, 0, -1, next);
			},
			(uids, next) => {
				if (!uids.length) {
					return next();
				}
				var keys = uids.map(uid => 'uid:' + uid + ':chat:room:' + roomId + ':mids');
				db.sortedSetsRemove(keys, mid, next);
			},
			(next) => {
				db.delete('message:' + mid, next);
			},
		], callback);
	};
};
