var async = require('async');
var validator = require('validator');

var user = require('../user');
var groups = require('../groups');
var meta = require('../meta');
var plugins = require('../plugins');

module.exports = (Posts) => {
	Posts.getUserInfoForPosts = (uids, uid, callback) => {
		var groupsMap = {};
		var userData;
		var userSettings;
		async.waterfall([
			(next) => {
				async.parallel({
					userData: (next) => {
						user.getUsersFields(uids, ['uid', 'username', 'fullname', 'userslug', 'reputation', 'postcount', 'picture', 'signature', 'banned', 'status', 'lastonline', 'groupTitle'], next);
					},
					userSettings: (next) => {
						user.getMultipleUserSettings(uids, next);
					},
				}, next);
			},
			(results, next) => {
				userData = results.userData;
				userSettings = results.userSettings;
				var groupTitles = userData.map(userData => userData && userData.groupTitle).filter((groupTitle, index, array) => groupTitle && array.indexOf(groupTitle) === index);
				groups.getGroupsData(groupTitles, next);
			},
			(groupsData, next) => {
				groupsData.forEach((group) => {
					if (group && group.userTitleEnabled) {
						groupsMap[group.name] = {
							name: group.name,
							slug: group.slug,
							labelColor: group.labelColor,
							icon: group.icon,
							userTitle: group.userTitle,
						};
					}
				});

				userData.forEach((userData, index) => {
					userData.uid = userData.uid || 0;
					userData.username = userData.username || '[[global:guest]]';
					userData.userslug = userData.userslug || '';
					userData.reputation = userData.reputation || 0;
					userData.postcount = userData.postcount || 0;
					userData.banned = parseInt(userData.banned, 10) === 1;
					userData.picture = userData.picture || '';
					userData.status = user.getStatus(userData);
					userData.signature = validator.escape(String(userData.signature || ''));
					userData.fullname = userSettings[index].showfullname ? validator.escape(String(userData.fullname || '')) : undefined;
					if (parseInt(meta.config.hideFullname, 10) === 1) {
						userData.fullname = undefined;
					}
				});

				async.map(userData, (userData, next) => {
					async.waterfall([
						(next) => {
							async.parallel({
								isMemberOfGroup: (next) => {
									if (!userData.groupTitle || !groupsMap[userData.groupTitle]) {
										return next();
									}
									groups.isMember(userData.uid, userData.groupTitle, next);
								},
								signature: (next) => {
									if (!userData.signature || parseInt(meta.config.disableSignatures, 10) === 1) {
										userData.signature = '';
										return next();
									}
									Posts.parseSignature(userData, uid, next);
								},
								customProfileInfo: (next) => {
									plugins.fireHook('filter:posts.custom_profile_info', { profile: [], uid: userData.uid }, next);
								},
							}, next);
						},
						(results, next) => {
							if (results.isMemberOfGroup && userData.groupTitle && groupsMap[userData.groupTitle]) {
								userData.selectedGroup = groupsMap[userData.groupTitle];
							}

							userData.custom_profile_info = results.customProfileInfo.profile;

							plugins.fireHook('filter:posts.modifyUserInfo', userData, next);
						},
					], next);
				}, next);
			},
		], callback);
	};

	Posts.isOwner = (pid, uid, callback) => {
		uid = parseInt(uid, 10);
		if (Array.isArray(pid)) {
			if (!uid) {
				return callback(null, pid.map(() => false));
			}
			Posts.getPostsFields(pid, ['uid'], (err, posts) => {
				if (err) {
					return callback(err);
				}
				posts = posts.map(post => post && parseInt(post.uid, 10) === uid);
				callback(null, posts);
			});
		} else {
			if (!uid) {
				return callback(null, false);
			}
			Posts.getPostField(pid, 'uid', (err, author) => {
				callback(err, parseInt(author, 10) === uid);
			});
		}
	};

	Posts.isModerator = (pids, uid, callback) => {
		if (!parseInt(uid, 10)) {
			return callback(null, pids.map(() => false));
		}
		Posts.getCidsByPids(pids, (err, cids) => {
			if (err) {
				return callback(err);
			}
			user.isModerator(uid, cids, callback);
		});
	};
};
