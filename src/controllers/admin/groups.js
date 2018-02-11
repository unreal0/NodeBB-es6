

var async = require('async');
var validator = require('validator');

var db = require('../../database');
var groups = require('../../groups');
var meta = require('../../meta');
var pagination = require('../../pagination');

var groupsController = module.exports;

groupsController.list = (req, res, next) => {
	var page = parseInt(req.query.page, 10) || 1;
	var groupsPerPage = 20;
	var pageCount = 0;

	async.waterfall([
		(next) => {
			getGroupNames(next);
		},
		(groupNames, next) => {
			pageCount = Math.ceil(groupNames.length / groupsPerPage);

			var start = (page - 1) * groupsPerPage;
			var stop = start + groupsPerPage - 1;

			groupNames = groupNames.slice(start, stop + 1);
			groups.getGroupsData(groupNames, next);
		},
		(groupData) => {
			res.render('admin/manage/groups', {
				groups: groupData,
				pagination: pagination.create(page, pageCount),
				yourid: req.uid,
			});
		},
	], next);
};

groupsController.get = (req, res, callback) => {
	var groupName = req.params.name;
	async.waterfall([
		(next) => {
			async.parallel({
				groupNames: (next) => {
					getGroupNames(next);
				},
				group: (next) => {
					groups.get(groupName, { uid: req.uid, truncateUserList: true, userListCount: 20 }, next);
				},
			}, next);
		},
		(result) => {
			if (!result.group) {
				return callback();
			}
			result.group.isOwner = true;

			result.groupNames = result.groupNames.map(name => ({
				encodedName: encodeURIComponent(name),
				displayName: validator.escape(String(name)),
				selected: name === groupName,
			}));

			res.render('admin/manage/group', {
				group: result.group,
				groupNames: result.groupNames,
				allowPrivateGroups: parseInt(meta.config.allowPrivateGroups, 10) === 1,
			});
		},
	], callback);
};

function getGroupNames(callback) {
	async.waterfall([
		(next) => {
			db.getSortedSetRange('groups:createtime', 0, -1, next);
		},
		(groupNames, next) => {
			groupNames = groupNames.filter(name => name !== 'registered-users' && !groups.isPrivilegeGroup(name));
			next(null, groupNames);
		},
	], callback);
}
