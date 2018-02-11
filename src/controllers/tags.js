

var async = require('async');
var validator = require('validator');

var user = require('../user');
var topics = require('../topics');
var pagination = require('../pagination');
var helpers = require('./helpers');

var tagsController = module.exports;

tagsController.getTag = (req, res, next) => {
	var tag = validator.escape(String(req.params.tag));
	var page = parseInt(req.query.page, 10) || 1;

	var templateData = {
		topics: [],
		tag: tag,
		breadcrumbs: helpers.buildBreadcrumbs([{ text: '[[tags:tags]]', url: '/tags' }, { text: tag }]),
		title: '[[pages:tag, ' + tag + ']]',
	};
	var settings;
	var topicCount = 0;
	async.waterfall([
		(next) => {
			user.getSettings(req.uid, next);
		},
		(_settings, next) => {
			settings = _settings;
			var start = Math.max(0, (page - 1) * settings.topicsPerPage);
			var stop = start + settings.topicsPerPage - 1;
			templateData.nextStart = stop + 1;
			async.parallel({
				topicCount: (next) => {
					topics.getTagTopicCount(req.params.tag, next);
				},
				tids: (next) => {
					topics.getTagTids(req.params.tag, start, stop, next);
				},
			}, next);
		},
		(results, next) => {
			if (Array.isArray(results.tids) && !results.tids.length) {
				return res.render('tag', templateData);
			}
			topicCount = results.topicCount;
			topics.getTopics(results.tids, req.uid, next);
		},
		(topics) => {
			res.locals.metaTags = [
				{
					name: 'title',
					content: tag,
				},
				{
					property: 'og:title',
					content: tag,
				},
			];
			templateData.topics = topics;

			var pageCount =	Math.max(1, Math.ceil(topicCount / settings.topicsPerPage));
			templateData.pagination = pagination.create(page, pageCount);

			res.render('tag', templateData);
		},
	], next);
};

tagsController.getTags = (req, res, next) => {
	async.waterfall([
		(next) => {
			topics.getTags(0, 99, next);
		},
		(tags) => {
			tags = tags.filter(Boolean);
			var data = {
				tags: tags,
				nextStart: 100,
				breadcrumbs: helpers.buildBreadcrumbs([{ text: '[[tags:tags]]' }]),
				title: '[[pages:tags]]',
			};
			res.render('tags', data);
		},
	], next);
};
