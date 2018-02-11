var async = require('async');

var db = require('../database');
var user = require('../user');

module.exports = (Groups) => {
	Groups.getUsersFromSet = (set, fields, callback) => {
		if (typeof fields === 'function') {
			callback = fields;
			fields = null;
		}
		async.waterfall([
			(next) => {
				db.getSetMembers(set, next);
			},
			(uids, next) => {
				if (fields) {
					user.getUsersFields(uids, fields, callback);
				} else {
					user.getUsersData(uids, next);
				}
			},
		], callback);
	};

	Groups.getUserGroups = (uids, callback) => {
		Groups.getUserGroupsFromSet('groups:visible:createtime', uids, callback);
	};

	Groups.getUserGroupsFromSet = (set, uids, callback) => {
		async.waterfall([
			(next) => {
				Groups.getUserGroupMembership(set, uids, next);
			},
			(memberOf, next) => {
				async.map(memberOf, (memberOf, next) => {
					Groups.getGroupsData(memberOf, next);
				}, next);
			},
		], callback);
	};

	Groups.getUserGroupMembership = (set, uids, callback) => {
		async.waterfall([
			(next) => {
				db.getSortedSetRevRange(set, 0, -1, next);
			},
			(groupNames, next) => {
				async.map(uids, (uid, next) => {
					async.waterfall([
						(next) => {
							Groups.isMemberOfGroups(uid, groupNames, next);
						},
						(isMembers, next) => {
							var memberOf = [];
							isMembers.forEach((isMember, index) => {
								if (isMember) {
									memberOf.push(groupNames[index]);
								}
							});

							next(null, memberOf);
						},
					], next);
				}, next);
			},
		], callback);
	};
};
