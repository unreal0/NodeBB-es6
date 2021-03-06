var fs = require('fs');
var nconf = require('nconf');
var path = require('path');
var winston = require('winston');
var jimp = require('jimp');
var mkdirp = require('mkdirp');
var mime = require('mime');
var graceful = require('graceful-fs');

var utils = require('./utils');

graceful.gracefulify(fs);

var file = module.exports;

/**
 * Asynchronously copies `src` to `dest`
 * @param {string} src - source filename to copy
 * @param {string} dest - destination filename of the copy operation
 * @param {function(Error): void} callback
 */
function copyFile(src, dest, callback) {
	var calledBack = false;

	var read;
	var write;

	function done(err) {
		if (calledBack) {
			return;
		}
		calledBack = true;

		if (err) {
			if (read) {
				read.destroy();
			}
			if (write) {
				write.destroy();
			}
		}

		callback(err);
	}

	read = fs.createReadStream(src);
	read.on('error', done);

	write = fs.createWriteStream(dest);
	write.on('error', done);
	write.on('close', () => {
		done();
	});

	read.pipe(write);
}

file.copyFile = (typeof fs.copyFile === 'function') ? fs.copyFile : copyFile;

file.saveFileToLocal = (filename, folder, tempPath, callback) => {
	/*
	 * remarkable doesn't allow spaces in hyperlinks, once that's fixed, remove this.
	 */
	filename = filename.split('.').map(name => utils.slugify(name)).join('.');

	var uploadPath = path.join(nconf.get('upload_path'), folder, filename);

	winston.verbose('Saving file ' + filename + ' to : ' + uploadPath);
	mkdirp(path.dirname(uploadPath), (err) => {
		if (err) {
			return callback(err);
		}

		file.copyFile(tempPath, uploadPath, (err) => {
			if (err) {
				return callback(err);
			}

			callback(null, {
				url: '/assets/uploads/' + folder + '/' + filename,
				path: uploadPath,
			});
		});
	});
};

file.base64ToLocal = (imageData, uploadPath, callback) => {
	var buffer = Buffer.from(imageData.slice(imageData.indexOf('base64') + 7), 'base64');
	uploadPath = path.join(nconf.get('upload_path'), uploadPath);

	fs.writeFile(uploadPath, buffer, {
		encoding: 'base64',
	}, (err) => {
		callback(err, uploadPath);
	});
};

file.isFileTypeAllowed = (path, callback) => {
	var plugins = require('./plugins');
	if (plugins.hasListeners('filter:file.isFileTypeAllowed')) {
		return plugins.fireHook('filter:file.isFileTypeAllowed', path, (err) => {
			callback(err);
		});
	}

	// Attempt to read the file, if it passes, file type is allowed
	jimp.read(path, (err) => {
		callback(err);
	});
};

file.allowedExtensions = () => {
	var meta = require('./meta');
	var allowedExtensions = (meta.config.allowedFileExtensions || '').trim();
	if (!allowedExtensions) {
		return [];
	}
	allowedExtensions = allowedExtensions.split(',');
	allowedExtensions = allowedExtensions.filter(Boolean).map((extension) => {
		extension = extension.trim();
		if (!extension.startsWith('.')) {
			extension = '.' + extension;
		}
		return extension.toLowerCase();
	});

	if (allowedExtensions.indexOf('.jpg') !== -1 && allowedExtensions.indexOf('.jpeg') === -1) {
		allowedExtensions.push('.jpeg');
	}

	return allowedExtensions;
};

file.exists = (path, callback) => {
	fs.stat(path, (err) => {
		if (err) {
			if (err.code === 'ENOENT') {
				return callback(null, false);
			}
		}
		callback(err, true);
	});
};

file.existsSync = (path) => {
	try {
		fs.statSync(path);
	} catch (err) {
		if (err.code === 'ENOENT') {
			return false;
		}
		throw err;
	}

	return true;
};

file.delete = (path) => {
	if (path) {
		fs.unlink(path, (err) => {
			if (err) {
				winston.error(err);
			}
		});
	}
};

file.link = function link(filePath, destPath, relative, callback) {
	if (!callback) {
		callback = relative;
		relative = false;
	}

	if (relative && process.platform !== 'win32') {
		filePath = path.relative(path.dirname(destPath), filePath);
	}

	if (process.platform === 'win32') {
		fs.link(filePath, destPath, callback);
	} else {
		fs.symlink(filePath, destPath, 'file', callback);
	}
};

file.linkDirs = function linkDirs(sourceDir, destDir, relative, callback) {
	if (!callback) {
		callback = relative;
		relative = false;
	}

	if (relative && process.platform !== 'win32') {
		sourceDir = path.relative(path.dirname(destDir), sourceDir);
	}

	var type = (process.platform === 'win32') ? 'junction' : 'dir';
	fs.symlink(sourceDir, destDir, type, callback);
};

file.typeToExtension = (type) => {
	var extension;
	if (type) {
		extension = '.' + mime.getExtension(type);
	}
	return extension;
};

// Adapted from http://stackoverflow.com/questions/5827612/node-js-fs-readdir-recursive-directory-search
file.walk = (dir, done) => {
	var results = [];

	fs.readdir(dir, (err, list) => {
		if (err) {
			return done(err);
		}
		var pending = list.length;
		if (!pending) {
			return done(null, results);
		}
		list.forEach((filename) => {
			filename = dir + '/' + filename;
			fs.stat(filename, (err, stat) => {
				if (err) {
					return done(err);
				}

				if (stat && stat.isDirectory()) {
					file.walk(filename, (err, res) => {
						if (err) {
							return done(err);
						}

						results = results.concat(res);
						pending -= 1;
						if (!pending) {
							done(null, results);
						}
					});
				} else {
					results.push(filename);
					pending -= 1;
					if (!pending) {
						done(null, results);
					}
				}
			});
		});
	});
};
