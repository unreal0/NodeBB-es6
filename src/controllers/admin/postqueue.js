

var async = require('async');

var db = require('../../database');
var user = require('../../user');
var topics = require('../../topics');
var categories = require('../../categories');
var pagination = require('../../pagination');
var utils = require('../../utils');

var postQueueController = module.exports;

postQueueController.get = (req, res, next) => {
	var page = parseInt(req.query.page, 10) || 1;
	var postsPerPage = 20;
	var results;
	async.waterfall([
		(next) => {
			async.parallel({
				ids: (next) => {
					db.getSortedSetRange('post:queue', 0, -1, next);
				},
				isAdminOrGlobalMod: (next) => {
					user.isAdminOrGlobalMod(req.uid, next);
				},
				moderatedCids: (next) => {
					user.getModeratedCids(req.uid, next);
				},
			}, next);
		},
		(_results, next) => {
			results = _results;
			getQueuedPosts(results.ids, next);
		},
		(postData) => {
			postData = postData.filter(postData => postData && (results.isAdminOrGlobalMod || results.moderatedCids.includes(String(postData.category.cid))));

			var pageCount = Math.max(1, Math.ceil(postData.length / postsPerPage));
			var start = (page - 1) * postsPerPage;
			var stop = start + postsPerPage - 1;
			postData = postData.slice(start, stop + 1);

			res.render('admin/manage/post-queue', {
				title: '[[pages:post-queue]]',
				posts: postData,
				pagination: pagination.create(page, pageCount),
			});
		},
	], next);
};

function getQueuedPosts(ids, callback) {
	var keys = ids.map(id => 'post:queue:' + id);
	var postData;
	async.waterfall([
		(next) => {
			db.getObjects(keys, next);
		},
		(data, next) => {
			postData = data;
			data.forEach((data) => {
				data.data = JSON.parse(data.data);
				data.data.timestampISO = utils.toISOString(data.data.timestamp);
				return data;
			});
			var uids = data.map(data => data && data.uid);
			user.getUsersFields(uids, ['username', 'userslug', 'picture'], next);
		},
		(userData, next) => {
			postData.forEach((postData, index) => {
				postData.user = userData[index];
			});

			async.map(postData, (postData, next) => {
				async.waterfall([
					(next) => {
						if (postData.data.cid) {
							next(null, { cid: postData.data.cid });
						} else if (postData.data.tid) {
							topics.getTopicFields(postData.data.tid, ['title', 'cid'], next);
						} else {
							next(null, { cid: 0 });
						}
					},
					(topicData, next) => {
						postData.topic = topicData;
						categories.getCategoryData(topicData.cid, next);
					},
					(categoryData, next) => {
						postData.category = categoryData;
						next(null, postData);
					},
				], next);
			}, next);
		},
	], callback);
}
