var async = require('async');
var _ = require('lodash');
var validator = require('validator');

var db = require('../database');
var user = require('../user');
var posts = require('../posts');
var meta = require('../meta');
var plugins = require('../plugins');
var utils = require('../../public/src/utils');

module.exports = (Topics) => {
	Topics.onNewPostMade = (postData, callback) => {
		async.series([
			(next) => {
				Topics.increasePostCount(postData.tid, next);
			},
			(next) => {
				Topics.updateTimestamp(postData.tid, postData.timestamp, next);
			},
			(next) => {
				Topics.addPostToTopic(postData.tid, postData, next);
			},
		], callback);
	};

	Topics.getTopicPosts = (tid, set, start, stop, uid, reverse, callback) => {
		async.waterfall([
			(next) => {
				async.parallel({
					posts: (next) => {
						posts.getPostsFromSet(set, start, stop, uid, reverse, next);
					},
					postCount: (next) => {
						Topics.getTopicField(tid, 'postcount', next);
					},
				}, next);
			},
			(results, next) => {
				Topics.calculatePostIndices(results.posts, start, stop, results.postCount, reverse);

				Topics.addPostData(results.posts, uid, next);
			},
		], callback);
	};

	Topics.addPostData = (postData, uid, callback) => {
		if (!Array.isArray(postData) || !postData.length) {
			return callback(null, []);
		}
		var pids = postData.map(post => post && post.pid);

		if (!Array.isArray(pids) || !pids.length) {
			return callback(null, []);
		}

		function getPostUserData(field, method, callback) {
			var uids = [];

			postData.forEach((postData) => {
				if (postData && parseInt(postData[field], 10) >= 0 && uids.indexOf(postData[field]) === -1) {
					uids.push(postData[field]);
				}
			});

			async.waterfall([
				(next) => {
					method(uids, next);
				},
				(users, next) => {
					var userData = {};
					users.forEach((user, index) => {
						userData[uids[index]] = user;
					});
					next(null, userData);
				},
			], callback);
		}

		async.waterfall([
			(next) => {
				async.parallel({
					bookmarks: (next) => {
						posts.hasBookmarked(pids, uid, next);
					},
					voteData: (next) => {
						posts.getVoteStatusByPostIDs(pids, uid, next);
					},
					userData: (next) => {
						getPostUserData('uid', (uids, next) => {
							posts.getUserInfoForPosts(uids, uid, next);
						}, next);
					},
					editors: (next) => {
						getPostUserData('editor', (uids, next) => {
							user.getUsersFields(uids, ['uid', 'username', 'userslug'], next);
						}, next);
					},
					parents: (next) => {
						Topics.addParentPosts(postData, next);
					},
					replies: (next) => {
						getPostReplies(pids, uid, next);
					},
				}, next);
			},
			(results, next) => {
				postData.forEach((postObj, i) => {
					if (postObj) {
						postObj.deleted = parseInt(postObj.deleted, 10) === 1;
						postObj.user = parseInt(postObj.uid, 10) ? results.userData[postObj.uid] : _.clone(results.userData[postObj.uid]);
						postObj.editor = postObj.editor ? results.editors[postObj.editor] : null;
						postObj.bookmarked = results.bookmarks[i];
						postObj.upvoted = results.voteData.upvotes[i];
						postObj.downvoted = results.voteData.downvotes[i];
						postObj.votes = postObj.votes || 0;
						postObj.replies = results.replies[i];
						postObj.selfPost = !!parseInt(uid, 10) && parseInt(uid, 10) === parseInt(postObj.uid, 10);

						// Username override for guests, if enabled
						if (parseInt(meta.config.allowGuestHandles, 10) === 1 && parseInt(postObj.uid, 10) === 0 && postObj.handle) {
							postObj.user.username = validator.escape(String(postObj.handle));
						}
					}
				});
				plugins.fireHook('filter:topics.addPostData', {
					posts: postData,
					uid: uid,
				}, next);
			},
			(data, next) => {
				next(null, data.posts);
			},
		], callback);
	};

	Topics.modifyPostsByPrivilege = (topicData, topicPrivileges) => {
		var loggedIn = !!parseInt(topicPrivileges.uid, 10);
		topicData.posts.forEach((post) => {
			if (post) {
				post.display_edit_tools = topicPrivileges.isAdminOrMod || (post.selfPost && topicPrivileges['posts:edit']);
				post.display_delete_tools = topicPrivileges.isAdminOrMod || (post.selfPost && topicPrivileges['posts:delete']);
				post.display_moderator_tools = post.display_edit_tools || post.display_delete_tools;
				post.display_move_tools = topicPrivileges.isAdminOrMod && post.index !== 0;
				post.display_post_menu = topicPrivileges.isAdminOrMod || (post.selfPost && !topicData.locked) || ((loggedIn || topicData.postSharing.length) && !post.deleted);
				post.ip = topicPrivileges.isAdminOrMod ? post.ip : undefined;

				posts.modifyPostByPrivilege(post, topicPrivileges.isAdminOrMod);
			}
		});
	};

	Topics.addParentPosts = (postData, callback) => {
		var parentPids = postData.map(postObj => (postObj && postObj.hasOwnProperty('toPid') ? parseInt(postObj.toPid, 10) : null)).filter(Boolean);

		if (!parentPids.length) {
			return callback();
		}

		var parentPosts;
		async.waterfall([
			async.apply(posts.getPostsFields, parentPids, ['uid']),
			(_parentPosts, next) => {
				parentPosts = _parentPosts;
				var parentUids = _.uniq(parentPosts.map(postObj => postObj && parseInt(postObj.uid, 10)));

				user.getUsersFields(parentUids, ['username'], next);
			},
			(userData, next) => {
				var usersMap = {};
				userData.forEach((user) => {
					usersMap[user.uid] = user.username;
				});
				var parents = {};
				parentPosts.forEach((post, i) => {
					parents[parentPids[i]] = { username: usersMap[post.uid] };
				});

				postData.forEach((post) => {
					post.parent = parents[post.toPid];
				});
				next();
			},
		], callback);
	};

	Topics.calculatePostIndices = (posts, start, stop, postCount, reverse) => {
		posts.forEach((post, index) => {
			if (reverse) {
				post.index = postCount - (start + index + 1);
			} else {
				post.index = start + index + 1;
			}
		});
	};

	Topics.getLatestUndeletedPid = (tid, callback) => {
		async.waterfall([
			(next) => {
				Topics.getLatestUndeletedReply(tid, next);
			},
			(pid, next) => {
				if (parseInt(pid, 10)) {
					return callback(null, pid.toString());
				}
				Topics.getTopicField(tid, 'mainPid', next);
			},
			(mainPid, next) => {
				posts.getPostFields(mainPid, ['pid', 'deleted'], next);
			},
			(mainPost, next) => {
				next(null, parseInt(mainPost.pid, 10) && parseInt(mainPost.deleted, 10) !== 1 ? mainPost.pid.toString() : null);
			},
		], callback);
	};

	Topics.getLatestUndeletedReply = (tid, callback) => {
		var isDeleted = false;
		var done = false;
		var latestPid = null;
		var index = 0;
		var pids;
		async.doWhilst(
			(next) => {
				async.waterfall([
					(_next) => {
						db.getSortedSetRevRange('tid:' + tid + ':posts', index, index, _next);
					},
					(_pids, _next) => {
						pids = _pids;
						if (!pids.length) {
							done = true;
							return next();
						}

						posts.getPostField(pids[0], 'deleted', _next);
					},
					(deleted, _next) => {
						isDeleted = parseInt(deleted, 10) === 1;
						if (!isDeleted) {
							latestPid = pids[0];
						}
						index += 1;
						_next();
					},
				], next);
			},
			() => isDeleted && !done,
			(err) => {
				callback(err, latestPid);
			}
		);
	};

	Topics.addPostToTopic = (tid, postData, callback) => {
		async.waterfall([
			(next) => {
				Topics.getTopicField(tid, 'mainPid', next);
			},
			(mainPid, next) => {
				if (!parseInt(mainPid, 10)) {
					Topics.setTopicField(tid, 'mainPid', postData.pid, next);
				} else {
					async.parallel([
						(next) => {
							db.sortedSetAdd('tid:' + tid + ':posts', postData.timestamp, postData.pid, next);
						},
						(next) => {
							var upvotes = parseInt(postData.upvotes, 10) || 0;
							var downvotes = parseInt(postData.downvotes, 10) || 0;
							var votes = upvotes - downvotes;
							db.sortedSetAdd('tid:' + tid + ':posts:votes', votes, postData.pid, next);
						},
					], (err) => {
						next(err);
					});
				}
			},
			(next) => {
				db.sortedSetIncrBy('tid:' + tid + ':posters', 1, postData.uid, next);
			},
			(count, next) => {
				Topics.updateTeaser(tid, next);
			},
		], callback);
	};

	Topics.removePostFromTopic = (tid, postData, callback) => {
		async.waterfall([
			(next) => {
				db.sortedSetsRemove([
					'tid:' + tid + ':posts',
					'tid:' + tid + ':posts:votes',
				], postData.pid, next);
			},
			(next) => {
				db.sortedSetIncrBy('tid:' + tid + ':posters', -1, postData.uid, next);
			},
			(count, next) => {
				Topics.updateTeaser(tid, next);
			},
		], callback);
	};

	Topics.getPids = (tid, callback) => {
		async.waterfall([
			(next) => {
				async.parallel({
					mainPid: (next) => {
						Topics.getTopicField(tid, 'mainPid', next);
					},
					pids: (next) => {
						db.getSortedSetRange('tid:' + tid + ':posts', 0, -1, next);
					},
				}, next);
			},
			(results, next) => {
				if (parseInt(results.mainPid, 10)) {
					results.pids = [results.mainPid].concat(results.pids);
				}
				next(null, results.pids);
			},
		], callback);
	};

	Topics.increasePostCount = (tid, callback) => {
		incrementFieldAndUpdateSortedSet(tid, 'postcount', 1, 'topics:posts', callback);
	};

	Topics.decreasePostCount = (tid, callback) => {
		incrementFieldAndUpdateSortedSet(tid, 'postcount', -1, 'topics:posts', callback);
	};

	Topics.increaseViewCount = (tid, callback) => {
		incrementFieldAndUpdateSortedSet(tid, 'viewcount', 1, 'topics:views', callback);
	};

	function incrementFieldAndUpdateSortedSet(tid, field, by, set, callback) {
		callback = callback || function () {};
		async.waterfall([
			(next) => {
				db.incrObjectFieldBy('topic:' + tid, field, by, next);
			},
			(value, next) => {
				db.sortedSetAdd(set, value, tid, next);
			},
		], callback);
	}

	Topics.getTitleByPid = (pid, callback) => {
		Topics.getTopicFieldByPid('title', pid, callback);
	};

	Topics.getTopicFieldByPid = (field, pid, callback) => {
		async.waterfall([
			(next) => {
				posts.getPostField(pid, 'tid', next);
			},
			(tid, next) => {
				Topics.getTopicField(tid, field, next);
			},
		], callback);
	};

	Topics.getTopicDataByPid = (pid, callback) => {
		async.waterfall([
			(next) => {
				posts.getPostField(pid, 'tid', next);
			},
			(tid, next) => {
				Topics.getTopicData(tid, next);
			},
		], callback);
	};

	Topics.getPostCount = (tid, callback) => {
		db.getObjectField('topic:' + tid, 'postcount', callback);
	};

	function getPostReplies(pids, callerUid, callback) {
		var arrayOfReplyPids;
		var replyData;
		var uniqueUids;
		var uniquePids;
		async.waterfall([
			(next) => {
				var keys = pids.map(pid => 'pid:' + pid + ':replies');
				db.getSortedSetsMembers(keys, next);
			},
			(arrayOfPids, next) => {
				arrayOfReplyPids = arrayOfPids;

				uniquePids = _.uniq(_.flatten(arrayOfPids));

				posts.getPostsFields(uniquePids, ['pid', 'uid', 'timestamp'], next);
			},
			(_replyData, next) => {
				replyData = _replyData;
				var uids = replyData.map(replyData => replyData && replyData.uid);

				uniqueUids = _.uniq(uids);

				user.getUsersWithFields(uniqueUids, ['uid', 'username', 'userslug', 'picture'], callerUid, next);
			},
			(userData, next) => {
				var uidMap = _.zipObject(uniqueUids, userData);
				var pidMap = _.zipObject(uniquePids, replyData);

				var returnData = arrayOfReplyPids.map((replyPids) => {
					var uidsUsed = {};
					var currentData = {
						hasMore: false,
						users: [],
						text: replyPids.length > 1 ? '[[topic:replies_to_this_post, ' + replyPids.length + ']]' : '[[topic:one_reply_to_this_post]]',
						count: replyPids.length,
						timestampISO: replyPids.length ? utils.toISOString(pidMap[replyPids[0]].timestamp) : undefined,
					};

					replyPids.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

					replyPids.forEach((replyPid) => {
						var replyData = pidMap[replyPid];
						if (!uidsUsed[replyData.uid] && currentData.users.length < 6) {
							currentData.users.push(uidMap[replyData.uid]);
							uidsUsed[replyData.uid] = true;
						}
					});

					if (currentData.users.length > 5) {
						currentData.users.pop();
						currentData.hasMore = true;
					}

					return currentData;
				});

				next(null, returnData);
			},
		], callback);
	}
};
