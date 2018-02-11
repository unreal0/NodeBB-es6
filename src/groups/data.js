var async = require('async');
var validator = require('validator');

var db = require('../database');
var plugins = require('../plugins');
var utils = require('../utils');

module.exports = (Groups) => {
	Groups.getGroupsData = (groupNames, callback) => {
		if (!Array.isArray(groupNames) || !groupNames.length) {
			return callback(null, []);
		}

		var keys = groupNames.map(groupName => 'group:' + groupName);

		var ephemeralIdx = groupNames.reduce((memo, cur, idx) => {
			if (Groups.ephemeralGroups.indexOf(cur) !== -1) {
				memo.push(idx);
			}
			return memo;
		}, []);

		async.waterfall([
			(next) => {
				db.getObjects(keys, next);
			},
			(groupData, next) => {
				if (ephemeralIdx.length) {
					ephemeralIdx.forEach((idx) => {
						groupData[idx] = Groups.getEphemeralGroup(groupNames[idx]);
					});
				}

				groupData.forEach((group) => {
					if (group) {
						Groups.escapeGroupData(group);
						group.userTitleEnabled = group.userTitleEnabled ? parseInt(group.userTitleEnabled, 10) === 1 : true;
						group.labelColor = validator.escape(String(group.labelColor || '#000000'));
						group.icon = validator.escape(String(group.icon || ''));
						group.createtimeISO = utils.toISOString(group.createtime);
						group.hidden = parseInt(group.hidden, 10) === 1;
						group.system = parseInt(group.system, 10) === 1;
						group.private = (group.private === null || group.private === undefined) ? true : !!parseInt(group.private, 10);
						group.disableJoinRequests = parseInt(group.disableJoinRequests, 10) === 1;

						group['cover:url'] = group['cover:url'] || require('../coverPhoto').getDefaultGroupCover(group.name);
						group['cover:thumb:url'] = group['cover:thumb:url'] || group['cover:url'];
						group['cover:position'] = validator.escape(String(group['cover:position'] || '50% 50%'));
					}
				});

				plugins.fireHook('filter:groups.get', { groups: groupData }, next);
			},
			(results, next) => {
				next(null, results.groups);
			},
		], callback);
	};

	Groups.getGroupData = (groupName, callback) => {
		Groups.getGroupsData([groupName], (err, groupsData) => {
			callback(err, Array.isArray(groupsData) && groupsData[0] ? groupsData[0] : null);
		});
	};

	Groups.getGroupFields = (groupName, fields, callback) => {
		Groups.getMultipleGroupFields([groupName], fields, (err, groups) => {
			callback(err, groups ? groups[0] : null);
		});
	};

	Groups.getMultipleGroupFields = (groups, fields, callback) => {
		db.getObjectsFields(groups.map(group => 'group:' + group), fields, callback);
	};

	Groups.setGroupField = (groupName, field, value, callback) => {
		async.waterfall([
			(next) => {
				db.setObjectField('group:' + groupName, field, value, next);
			},
			(next) => {
				plugins.fireHook('action:group.set', { field: field, value: value, type: 'set' });
				next();
			},
		], callback);
	};
};
