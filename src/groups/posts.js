var async = require('async');

var db = require('../database');
var privileges = require('../privileges');
var posts = require('../posts');

module.exports = (Groups) => {
	Groups.onNewPostMade = (postData, callback) => {
		if (!parseInt(postData.uid, 10)) {
			return setImmediate(callback);
		}

		var groupNames;
		async.waterfall([
			(next) => {
				Groups.getUserGroupMembership('groups:visible:createtime', [postData.uid], next);
			},
			(_groupNames, next) => {
				groupNames = _groupNames[0];

				var keys = groupNames.map(groupName => 'group:' + groupName + ':member:pids');

				db.sortedSetsAdd(keys, postData.timestamp, postData.pid, next);
			},
			(next) => {
				async.each(groupNames, (groupName, next) => {
					truncateMemberPosts(groupName, next);
				}, next);
			},
		], callback);
	};

	function truncateMemberPosts(groupName, callback) {
		async.waterfall([
			(next) => {
				db.getSortedSetRevRange('group:' + groupName + ':member:pids', 10, 10, next);
			},
			(lastPid, next) => {
				lastPid = lastPid[0];
				if (!parseInt(lastPid, 10)) {
					return callback();
				}
				db.sortedSetScore('group:' + groupName + ':member:pids', lastPid, next);
			},
			(score, next) => {
				db.sortedSetsRemoveRangeByScore(['group:' + groupName + ':member:pids'], '-inf', score, next);
			},
		], callback);
	}

	Groups.getLatestMemberPosts = (groupName, max, uid, callback) => {
		async.waterfall([
			(next) => {
				db.getSortedSetRevRange('group:' + groupName + ':member:pids', 0, max - 1, next);
			},
			(pids, next) => {
				privileges.posts.filter('read', pids, uid, next);
			},
			(pids, next) => {
				posts.getPostSummaryByPids(pids, uid, { stripTags: false }, next);
			},
		], callback);
	};
};
