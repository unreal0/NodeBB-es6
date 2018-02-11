var async = require('async');
var _ = require('lodash');

var user = require('../user');
var groups = require('../groups');
var helpers = require('./helpers');
var plugins = require('../plugins');

module.exports = (privileges) => {
	privileges.global = {};

	privileges.global.privilegeLabels = [
		{ name: 'Chat' },
		{ name: 'Upload Images' },
		{ name: 'Upload Files' },
	];

	privileges.global.userPrivilegeList = [
		'chat',
		'upload:post:image',
		'upload:post:file',
	];

	privileges.global.groupPrivilegeList = privileges.global.userPrivilegeList.map(privilege => 'groups:' + privilege);

	privileges.global.list = (callback) => {
		async.waterfall([
			(next) => {
				async.parallel({
					labels: (next) => {
						async.parallel({
							users: async.apply(plugins.fireHook, 'filter:privileges.global.list_human', privileges.global.privilegeLabels.slice()),
							groups: async.apply(plugins.fireHook, 'filter:privileges.global.groups.list_human', privileges.global.privilegeLabels.slice()),
						}, next);
					},
					users: (next) => {
						helpers.getUserPrivileges(0, 'filter:privileges.global.list', privileges.global.userPrivilegeList, next);
					},
					groups: (next) => {
						helpers.getGroupPrivileges(0, 'filter:privileges.global.groups.list', privileges.global.groupPrivilegeList, next);
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

	privileges.global.get = (uid, callback) => {
		async.waterfall([
			(next) => {
				async.parallel({
					privileges: (next) => {
						helpers.isUserAllowedTo(privileges.global.userPrivilegeList, uid, 0, next);
					},
					isAdministrator: (next) => {
						user.isAdministrator(uid, next);
					},
					isGlobalModerator: (next) => {
						user.isGlobalModerator(uid, next);
					},
				}, next);
			},
			(results, next) => {
				var privData = _.zipObject(privileges.global.userPrivilegeList, results.privileges);
				var isAdminOrMod = results.isAdministrator || results.isGlobalModerator;

				plugins.fireHook('filter:privileges.global.get', {
					chat: privData.chat || isAdminOrMod,
					'upload:post:image': privData['upload:post:image'] || isAdminOrMod,
					'upload:post:file': privData['upload:post:file'] || isAdminOrMod,
				}, next);
			},
		], callback);
	};

	privileges.global.can = (privilege, uid, callback) => {
		helpers.some([
			(next) => {
				helpers.isUserAllowedTo(privilege, uid, [0], (err, results) => {
					next(err, Array.isArray(results) && results.length ? results[0] : false);
				});
			},
			(next) => {
				user.isGlobalModerator(uid, next);
			},
			(next) => {
				user.isAdministrator(uid, next);
			},
		], callback);
	};

	privileges.global.give = (privileges, groupName, callback) => {
		helpers.giveOrRescind(groups.join, privileges, 0, groupName, callback);
	};

	privileges.global.rescind = (privileges, groupName, callback) => {
		helpers.giveOrRescind(groups.leave, privileges, 0, groupName, callback);
	};

	privileges.global.userPrivileges = (uid, callback) => {
		var tasks = {};

		privileges.global.userPrivilegeList.forEach((privilege) => {
			tasks[privilege] = async.apply(groups.isMember, uid, 'cid:0:privileges:' + privilege);
		});

		async.parallel(tasks, callback);
	};

	privileges.global.groupPrivileges = (groupName, callback) => {
		var tasks = {};

		privileges.global.groupPrivilegeList.forEach((privilege) => {
			tasks[privilege] = async.apply(groups.isMember, groupName, 'cid:0:privileges:' + privilege);
		});

		async.parallel(tasks, callback);
	};
};
