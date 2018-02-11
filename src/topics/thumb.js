var async = require('async');
var nconf = require('nconf');
var path = require('path');
var fs = require('fs');
var request = require('request');
var mime = require('mime');
var validator = require('validator');

var meta = require('../meta');
var image = require('../image');
var file = require('../file');
var plugins = require('../plugins');

module.exports = (Topics) => {
	Topics.resizeAndUploadThumb = (data, callback) => {
		if (!data.thumb || !validator.isURL(data.thumb)) {
			return callback();
		}

		var pathToUpload;
		var filename;

		async.waterfall([
			(next) => {
				request.head(data.thumb, next);
			},
			(res, body, next) => {
				var type = res.headers['content-type'];
				if (!type.match(/image./)) {
					return next(new Error('[[error:invalid-file]]'));
				}

				var extension = path.extname(data.thumb);
				if (!extension) {
					extension = '.' + mime.getExtension(type);
				}
				filename = Date.now() + '-topic-thumb' + extension;
				pathToUpload = path.join(nconf.get('upload_path'), 'files', filename);

				request(data.thumb).pipe(fs.createWriteStream(pathToUpload)).on('close', next);
			},
			(next) => {
				file.isFileTypeAllowed(pathToUpload, next);
			},
			(next) => {
				var size = parseInt(meta.config.topicThumbSize, 10) || 120;
				image.resizeImage({
					path: pathToUpload,
					extension: path.extname(pathToUpload),
					width: size,
					height: size,
				}, next);
			},
			(next) => {
				if (!plugins.hasListeners('filter:uploadImage')) {
					data.thumb = '/assets/uploads/files/' + filename;
					return callback();
				}

				plugins.fireHook('filter:uploadImage', { image: { path: pathToUpload, name: '' }, uid: data.uid }, next);
			},
			(uploadedFile, next) => {
				file.delete(pathToUpload);
				data.thumb = uploadedFile.url;
				next();
			},
		], (err) => {
			if (err) {
				file.delete(pathToUpload);
			}
			callback(err);
		});
	};
};
