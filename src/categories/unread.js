

var async = require('async');

var db = require('../database');

module.exports = (Categories) => {
	Categories.markAsRead = (cids, uid, callback) => {
		callback = callback || function () {};
		if (!Array.isArray(cids) || !cids.length) {
			return callback();
		}
		var keys = cids.map(cid => 'cid:' + cid + ':read_by_uid');

		async.waterfall([
			(next) => {
				db.isMemberOfSets(keys, uid, next);
			},
			(hasRead, next) => {
				keys = keys.filter((key, index) => !hasRead[index]);

				if (!keys.length) {
					return callback();
				}

				db.setsAdd(keys, uid, next);
			},
		], callback);
	};

	Categories.markAsUnreadForAll = (cid, callback) => {
		if (!parseInt(cid, 10)) {
			return callback();
		}
		callback = callback || function () {};
		db.delete('cid:' + cid + ':read_by_uid', callback);
	};

	Categories.hasReadCategories = (cids, uid, callback) => {
		var sets = cids.map(cid => 'cid:' + cid + ':read_by_uid');

		db.isMemberOfSets(sets, uid, callback);
	};

	Categories.hasReadCategory = (cid, uid, callback) => {
		db.isSetMember('cid:' + cid + ':read_by_uid', uid, callback);
	};
};
