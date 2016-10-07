/// <binding AfterBuild='default' />
/*
This file in the main entry point for defining Gulp tasks and using Gulp plugins.
Click here to learn more. http://go.microsoft.com/fwlink/?LinkId=518007
*/


var browserify = require('browserify');
var gulp = require("gulp");
var uglify = require('gulp-uglify');
var gutil = require('gulp-util');
var source = require('vinyl-source-stream');
var buffer = require('vinyl-buffer');
var sourcemaps = require('gulp-sourcemaps');
gulp.task('default', function () {
    // set up the browserify instance on a task basis
    var b = browserify({
        entries: './src/app.js',
        debug: true
        // defining transforms here will avoid crashing your stream
    });
    return b.bundle()

            .pipe(source('data.js'))
            .pipe(buffer())
            .pipe(sourcemaps.init({ loadMaps: true }))
          // Add transformation tasks to the pipeline here.
          .pipe(uglify())
          .on('error', gutil.log)
        .pipe(sourcemaps.write('./'))
      .pipe(gulp.dest('./'));
});