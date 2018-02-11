var async = require('async');
var _ = require('lodash');

var categories = require('../categories');
var user = require('../user');
var groups = require('../groups');
var helpers = require('./helpers');
var plugins = require('../plugins');

module.exports = (privileges) => {
	privileges.categories = {};

	privileges.categories.list = (cid, callback) => {
		// Method used in admin/category controller to show all users/groups with privs in that given cid
		async.waterfall([
			(next) => {
				async.parallel({
					labels: (next) => {
						async.parallel({
							users: async.apply(plugins.fireHook, 'filter:privileges.list_human', privileges.privilegeLabels.slice()),
							groups: async.apply(plugins.fireHook, 'filter:privileges.groups.list_human', privileges.privilegeLabels.slice()),
						}, next);
					},
					users: (next) => {
						helpers.getUserPrivileges(cid, 'filter:privileges.list', privileges.userPrivilegeList, next);
					},
					groups: (next) => {
						helpers.getGroupPrivileges(cid, 'filter:privileges.groups.list', privileges.groupPrivilegeList, next);
					},
				}, next);
			},
			(payload, next) => {
				// This is a hack because I can't do {labels.users.length} to echo the count in templates.js
				payload.columnCount = payload.labels.users.length + 2;
				next(null, payload);
			},
		], callback);
	};

	privileges.categories.get = (cid, uid, callback) => {
		var privs = ['topics:create', 'topics:read', 'topics:tag', 'read'];
		async.waterfall([
			(next) => {
				async.parallel({
					privileges: (next) => {
						helpers.isUserAllowedTo(privs, uid, cid, next);
					},
					isAdministrator: (next) => {
						user.isAdministrator(uid, next);
					},
					isModerator: (next) => {
						user.isModerator(uid, cid, next);
					},
				}, next);
			},
			(results, next) => {
				var privData = _.zipObject(privs, results.privileges);
				var isAdminOrMod = results.isAdministrator || results.isModerator;

				plugins.fireHook('filter:privileges.categories.get', {
					'topics:create': privData['topics:create'] || isAdminOrMod,
					'topics:read': privData['topics:read'] || isAdminOrMod,
					'topics:tag': privData['topics:tag'] || isAdminOrMod,
					read: privData.read || isAdminOrMod,
					cid: cid,
					uid: uid,
					editable: isAdminOrMod,
					view_deleted: isAdminOrMod,
					isAdminOrMod: isAdminOrMod,
				}, next);
			},
		], callback);
	};

	privileges.categories.isAdminOrMod = (cid, uid, callback) => {
		if (!parseInt(uid, 10)) {
			return callback(null, false);
		}
		helpers.some([
			(next) => {
				user.isModerator(uid, cid, next);
			},
			(next) => {
				user.isAdministrator(uid, next);
			},
		], callback);
	};

	privileges.categories.isUserAllowedTo = (privilege, cid, uid, callback) => {
		if (!cid) {
			return callback(null, false);
		}
		helpers.isUserAllowedTo(privilege, uid, [cid], (err, results) => {
			callback(err, Array.isArray(results) && results.length ? results[0] : false);
		});
	};

	privileges.categories.can = (privilege, cid, uid, callback) => {
		if (!cid) {
			return callback(null, false);
		}

		async.waterfall([
			(next) => {
				categories.getCategoryField(cid, 'disabled', next);
			},
			(disabled, next) => {
				if (parseInt(disabled, 10) === 1) {
					return callback(null, false);
				}
				helpers.some([
					(next) => {
						helpers.isUserAllowedTo(privilege, uid, [cid], (err, results) => {
							next(err, Array.isArray(results) && results.length ? results[0] : false);
						});
					},
					(next) => {
						user.isModerator(uid, cid, next);
					},
					(next) => {
						user.isAdministrator(uid, next);
					},
				], next);
			},
		], callback);
	};

	privileges.categories.filterCids = (privilege, cids, uid, callback) => {
		if (!Array.isArray(cids) || !cids.length) {
			return callback(null, []);
		}

		cids = _.uniq(cids);

		async.waterfall([
			(next) => {
				privileges.categories.getBase(privilege, cids, uid, next);
			},
			(results, next) => {
				cids = cids.filter((cid, index) => !results.categories[index].disabled &&
						(results.allowedTo[index] || results.isAdmin || results.isModerators[index]));

				next(null, cids.filter(Boolean));
			},
		], callback);
	};

	privileges.categories.getBase = (privilege, cids, uid, callback) => {
		async.parallel({
			categories: (next) => {
				categories.getCategoriesFields(cids, ['disabled'], next);
			},
			allowedTo: (next) => {
				helpers.isUserAllowedTo(privilege, uid, cids, next);
			},
			isModerators: (next) => {
				user.isModerator(uid, cids, next);
			},
			isAdmin: (next) => {
				user.isAdministrator(uid, next);
			},
		}, callback);
	};

	privileges.categories.filterUids = (privilege, cid, uids, callback) => {
		if (!uids.length) {
			return callback(null, []);
		}

		uids = _.uniq(uids);

		async.waterfall([
			(next) => {
				async.parallel({
					allowedTo: (next) => {
						helpers.isUsersAllowedTo(privilege, uids, cid, next);
					},
					isModerators: (next) => {
						user.isModerator(uids, cid, next);
					},
					isAdmins: (next) => {
						user.isAdministrator(uids, next);
					},
				}, next);
			},
			(results, next) => {
				uids = uids.filter((uid, index) => results.allowedTo[index] || results.isModerators[index] || results.isAdmins[index]);
				next(null, uids);
			},
		], callback);
	};

	privileges.categories.give = (privileges, cid, groupName, callback) => {
		helpers.giveOrRescind(groups.join, privileges, cid, groupName, callback);
	};

	privileges.categories.rescind = (privileges, cid, groupName, callback) => {
		helpers.giveOrRescind(groups.leave, privileges, cid, groupName, callback);
	};

	privileges.categories.canMoveAllTopics = (currentCid, targetCid, uid, callback) => {
		async.waterfall([
			(next) => {
				async.parallel({
					isAdministrator: (next) => {
						user.isAdministrator(uid, next);
					},
					moderatorOfCurrent: (next) => {
						user.isModerator(uid, currentCid, next);
					},
					moderatorOfTarget: (next) => {
						user.isModerator(uid, targetCid, next);
					},
				}, next);
			},
			(results, next) => {
				next(null, results.isAdministrator || (results.moderatorOfCurrent && results.moderatorOfTarget));
			},
		], callback);
	};

	privileges.categories.userPrivileges = (cid, uid, callback) => {
		var tasks = {};

		privileges.userPrivilegeList.forEach((privilege) => {
			tasks[privilege] = async.apply(groups.isMember, uid, 'cid:' + cid + ':privileges:' + privilege);
		});

		async.parallel(tasks, callback);
	};

	privileges.categories.groupPrivileges = (cid, groupName, callback) => {
		var tasks = {};

		privileges.groupPrivilegeList.forEach((privilege) => {
			tasks[privilege] = async.apply(groups.isMember, groupName, 'cid:' + cid + ':privileges:' + privilege);
		});

		async.parallel(tasks, callback);
	};
};
