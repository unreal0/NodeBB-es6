var async = require('async');
var _ = require('lodash');

var meta = require('../meta');
var topics = require('../topics');
var user = require('../user');
var helpers = require('./helpers');
var categories = require('../categories');
var plugins = require('../plugins');

module.exports = (privileges) => {
	privileges.topics = {};

	privileges.topics.get = (tid, uid, callback) => {
		var topic;
		var privs = ['topics:reply', 'topics:read', 'topics:tag', 'topics:delete', 'posts:edit', 'posts:delete', 'read'];
		async.waterfall([
			async.apply(topics.getTopicFields, tid, ['cid', 'uid', 'locked', 'deleted']),
			(_topic, next) => {
				topic = _topic;
				async.parallel({
					privileges: async.apply(helpers.isUserAllowedTo, privs, uid, topic.cid),
					isAdministrator: async.apply(user.isAdministrator, uid),
					isModerator: async.apply(user.isModerator, uid, topic.cid),
					disabled: async.apply(categories.getCategoryField, topic.cid, 'disabled'),
				}, next);
			},
			(results, next) => {
				var privData = _.zipObject(privs, results.privileges);
				var disabled = parseInt(results.disabled, 10) === 1;
				var locked = parseInt(topic.locked, 10) === 1;
				var deleted = parseInt(topic.deleted, 10) === 1;
				var isOwner = !!parseInt(uid, 10) && parseInt(uid, 10) === parseInt(topic.uid, 10);
				var isAdminOrMod = results.isAdministrator || results.isModerator;
				var editable = isAdminOrMod;
				var deletable = isAdminOrMod || (isOwner && privData['topics:delete']);

				plugins.fireHook('filter:privileges.topics.get', {
					'topics:reply': (privData['topics:reply'] && !locked && !deleted) || isAdminOrMod,
					'topics:read': privData['topics:read'] || isAdminOrMod,
					'topics:tag': privData['topics:tag'] || isAdminOrMod,
					'topics:delete': (isOwner && privData['topics:delete']) || isAdminOrMod,
					'posts:edit': (privData['posts:edit'] && !locked) || isAdminOrMod,
					'posts:delete': (privData['posts:delete'] && !locked) || isAdminOrMod,
					read: privData.read || isAdminOrMod,
					view_thread_tools: editable || deletable,
					editable: editable,
					deletable: deletable,
					view_deleted: isAdminOrMod || isOwner,
					isAdminOrMod: isAdminOrMod,
					disabled: disabled,
					tid: tid,
					uid: uid,
				}, next);
			},
		], callback);
	};

	privileges.topics.can = (privilege, tid, uid, callback) => {
		async.waterfall([
			(next) => {
				topics.getTopicField(tid, 'cid', next);
			},
			(cid, next) => {
				privileges.categories.can(privilege, cid, uid, next);
			},
		], callback);
	};

	privileges.topics.filterTids = (privilege, tids, uid, callback) => {
		if (!Array.isArray(tids) || !tids.length) {
			return callback(null, []);
		}
		var cids;
		var topicsData;
		async.waterfall([
			(next) => {
				topics.getTopicsFields(tids, ['tid', 'cid', 'deleted'], next);
			},
			(_topicsData, next) => {
				topicsData = _topicsData;
				cids = _.uniq(topicsData.map(topic => topic.cid));

				privileges.categories.getBase(privilege, cids, uid, next);
			},
			(results, next) => {
				var isModOf = {};
				cids = cids.filter((cid, index) => {
					isModOf[cid] = results.isModerators[index];
					return !results.categories[index].disabled &&
						(results.allowedTo[index] || results.isAdmin || results.isModerators[index]);
				});

				tids = topicsData.filter(topic => cids.indexOf(topic.cid) !== -1 &&
						(parseInt(topic.deleted, 10) !== 1 || results.isAdmin || isModOf[topic.cid])).map(topic => topic.tid);

				plugins.fireHook('filter:privileges.topics.filter', {
					privilege: privilege,
					uid: uid,
					tids: tids,
				}, (err, data) => {
					next(err, data ? data.tids : null);
				});
			},
		], callback);
	};

	privileges.topics.filterUids = (privilege, tid, uids, callback) => {
		if (!Array.isArray(uids) || !uids.length) {
			return callback(null, []);
		}

		uids = _.uniq(uids);
		var topicData;
		async.waterfall([
			(next) => {
				topics.getTopicFields(tid, ['tid', 'cid', 'deleted'], next);
			},
			(_topicData, next) => {
				topicData = _topicData;
				async.parallel({
					disabled: (next) => {
						categories.getCategoryField(topicData.cid, 'disabled', next);
					},
					allowedTo: (next) => {
						helpers.isUsersAllowedTo(privilege, uids, topicData.cid, next);
					},
					isModerators: (next) => {
						user.isModerator(uids, topicData.cid, next);
					},
					isAdmins: (next) => {
						user.isAdministrator(uids, next);
					},
				}, next);
			},
			(results, next) => {
				uids = uids.filter((uid, index) => parseInt(results.disabled, 10) !== 1 &&
						((results.allowedTo[index] && parseInt(topicData.deleted, 10) !== 1) || results.isAdmins[index] || results.isModerators[index]));

				next(null, uids);
			},
		], callback);
	};

	privileges.topics.canPurge = (tid, uid, callback) => {
		async.waterfall([
			(next) => {
				topics.getTopicField(tid, 'cid', next);
			},
			(cid, next) => {
				async.parallel({
					purge: async.apply(privileges.categories.isUserAllowedTo, 'purge', cid, uid),
					owner: async.apply(topics.isOwner, tid, uid),
					isAdminOrMod: async.apply(privileges.categories.isAdminOrMod, cid, uid),
				}, next);
			},
			(results, next) => {
				next(null, results.isAdminOrMod || (results.purge && results.owner));
			},
		], callback);
	};

	privileges.topics.canDelete = (tid, uid, callback) => {
		var topicData;
		async.waterfall([
			(next) => {
				topics.getTopicFields(tid, ['cid', 'postcount'], next);
			},
			(_topicData, next) => {
				topicData = _topicData;
				async.parallel({
					isModerator: async.apply(user.isModerator, uid, topicData.cid),
					isAdministrator: async.apply(user.isAdministrator, uid),
					isOwner: async.apply(topics.isOwner, tid, uid),
					'topics:delete': async.apply(helpers.isUserAllowedTo, 'topics:delete', uid, [topicData.cid]),
				}, next);
			},
			(results, next) => {
				if (results.isModerator || results.isAdministrator) {
					return next(null, true);
				}

				var preventTopicDeleteAfterReplies = parseInt(meta.config.preventTopicDeleteAfterReplies, 10) || 0;
				if (preventTopicDeleteAfterReplies && (topicData.postcount - 1) >= preventTopicDeleteAfterReplies) {
					var langKey = preventTopicDeleteAfterReplies > 1 ?
						'[[error:cant-delete-topic-has-replies, ' + meta.config.preventTopicDeleteAfterReplies + ']]' :
						'[[error:cant-delete-topic-has-reply]]';
					return next(new Error(langKey));
				}

				if (!results['topics:delete'][0]) {
					return next(null, false);
				}

				next(null, results.isOwner);
			},
		], callback);
	};

	privileges.topics.canEdit = (tid, uid, callback) => {
		privileges.topics.isOwnerOrAdminOrMod(tid, uid, callback);
	};

	privileges.topics.isOwnerOrAdminOrMod = (tid, uid, callback) => {
		helpers.some([
			(next) => {
				topics.isOwner(tid, uid, next);
			},
			(next) => {
				privileges.topics.isAdminOrMod(tid, uid, next);
			},
		], callback);
	};

	privileges.topics.isAdminOrMod = (tid, uid, callback) => {
		helpers.some([
			(next) => {
				async.waterfall([
					(next) => {
						topics.getTopicField(tid, 'cid', next);
					},
					(cid, next) => {
						user.isModerator(uid, cid, next);
					},
				], next);
			},
			(next) => {
				user.isAdministrator(uid, next);
			},
		], callback);
	};
};
