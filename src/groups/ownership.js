

var async = require('async');
var db = require('../database');
var plugins = require('../plugins');

module.exports = (Groups) => {
	Groups.ownership = {};

	Groups.ownership.isOwner = (uid, groupName, callback) => {
		if (!uid) {
			return callback(null, false);
		}
		db.isSetMember('group:' + groupName + ':owners', uid, callback);
	};

	Groups.ownership.isOwners = (uids, groupName, callback) => {
		if (!Array.isArray(uids)) {
			return callback(null, []);
		}

		db.isSetMembers('group:' + groupName + ':owners', uids, callback);
	};

	Groups.ownership.grant = (toUid, groupName, callback) => {
		// Note: No ownership checking is done here on purpose!
		async.waterfall([
			(next) => {
				db.setAdd('group:' + groupName + ':owners', toUid, next);
			},
			(next) => {
				plugins.fireHook('action:group.grantOwnership', { uid: toUid, groupName: groupName });
				next();
			},
		], callback);
	};

	Groups.ownership.rescind = (toUid, groupName, callback) => {
		// Note: No ownership checking is done here on purpose!

		// If the owners set only contains one member, error out!
		async.waterfall([
			(next) => {
				db.setCount('group:' + groupName + ':owners', next);
			},
			(numOwners, next) => {
				if (numOwners <= 1) {
					return next(new Error('[[error:group-needs-owner]]'));
				}
				db.setRemove('group:' + groupName + ':owners', toUid, next);
			},
			(next) => {
				plugins.fireHook('action:group.rescindOwnership', { uid: toUid, groupName: groupName });
				next();
			},
		], callback);
	};
};
