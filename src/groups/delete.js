var async = require('async');
var plugins = require('../plugins');
var utils = require('../utils');
var db = require('./../database');
var batch = require('../batch');

module.exports = (Groups) => {
	Groups.destroy = (groupName, callback) => {
		var groupObj;
		async.waterfall([
			(next) => {
				Groups.getGroupsData([groupName], next);
			},
			(groupsData, next) => {
				if (!groupsData[0]) {
					return callback();
				}
				groupObj = groupsData[0];

				async.parallel([
					(next) => {
						db.deleteAll([
							'group:' + groupName,
							'group:' + groupName + ':members',
							'group:' + groupName + ':pending',
							'group:' + groupName + ':invited',
							'group:' + groupName + ':owners',
							'group:' + groupName + ':member:pids',
						], next);
					},
					(next) => {
						db.sortedSetsRemove([
							'groups:createtime',
							'groups:visible:createtime',
							'groups:visible:memberCount',
						], groupName, next);
					},
					(next) => {
						db.sortedSetRemove('groups:visible:name', groupName.toLowerCase() + ':' + groupName, next);
					},
					(next) => {
						db.deleteObjectField('groupslug:groupname', utils.slugify(groupName), next);
					},
					(next) => {
						removeGroupFromOtherGroups(groupName, next);
					},
				], (err) => {
					next(err);
				});
			},
			(next) => {
				Groups.resetCache();
				plugins.fireHook('action:group.destroy', { group: groupObj });
				next();
			},
		], callback);
	};

	function removeGroupFromOtherGroups(groupName, callback) {
		batch.processSortedSet('groups:createtime', (groupNames, next) => {
			var keys = groupNames.map(group => 'group:' + group + ':members');
			db.sortedSetsRemove(keys, groupName, next);
		}, {
			batch: 500,
		}, callback);
	}
};
