var db = require('../database');

module.exports = (Topics) => {
	Topics.isOwner = (tid, uid, callback) => {
		uid = parseInt(uid, 10);
		if (!uid) {
			return callback(null, false);
		}
		Topics.getTopicField(tid, 'uid', (err, author) => {
			callback(err, parseInt(author, 10) === uid);
		});
	};

	Topics.getUids = (tid, callback) => {
		db.getSortedSetRevRangeByScore('tid:' + tid + ':posters', 0, -1, '+inf', 1, callback);
	};
};
