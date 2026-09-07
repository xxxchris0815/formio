/* eslint-env mocha */
'use strict';

const assert = require('assert');
const request = require('./formio-supertest');
const { wait } = require('./util');

module.exports = function (app, template, hook) {
  const Helper = require('./helper')(app);
  let helper = null;
  let draft = null;

  describe('Save as Draft', function () {
    const components = [
      {
        type: 'textfield',
        key: 'firstName',
        label: 'First Name',
        input: true,
        validate: {
          required: true,
        },
      },
      {
        type: 'textfield',
        key: 'lastName',
        label: 'Last Name',
        input: true,
      },
      {
        type: 'email',
        key: 'email',
        label: 'Email',
        input: true,
        unique: true,
        validate: {
          required: true,
        },
      },
      {
        type: 'button',
        action: 'saveState',
        state: 'draft',
        key: 'saveDraft',
        label: 'Save as Draft',
        input: true,
      },
      {
        type: 'button',
        action: 'submit',
        key: 'submit',
        label: 'Submit',
        input: true,
      },
    ];

    it('Sets up a helper', function (done) {
      helper = new Helper(template.users.admin);
      helper.project().execute(done);
    });

    it('Should create a form with required fields', function (done) {
      helper.form('saveAsDraft', components).execute(done);
    });

    it('Should reject a submitted incomplete submission', function (done) {
      helper
        .submission({
          data: {
            firstName: 'Sarah',
          },
        })
        .expect(400)
        .execute(function (err) {
          if (err) {
            return done(err);
          }
          const body = helper.lastResponse.body;
          assert(body.name === 'ValidationError' || (body.details && body.details.length));
          done();
        });
    });

    it('Should save an incomplete submission as a draft', function (done) {
      helper
        .submission({
          state: 'draft',
          data: {
            firstName: 'Sarah',
            lastName: '',
          },
        })
        .execute(function (err) {
          if (err) {
            return done(err);
          }

          draft = helper.getLastSubmission();
          assert.equal(draft.state, 'draft');
          assert.equal(draft.data.firstName, 'Sarah');
          assert.equal(draft.data.lastName, '');
          assert(draft._id, 'Draft must have an _id');
          assert(draft.owner, 'Draft must be owned by the authenticated user');
          done();
        });
    });

    it('Should update a draft without requiring missing fields', function (done) {
      const update = { ...draft, state: 'draft', data: { ...draft.data, email: 'sarah@example.com' } };
      helper
        .submission('saveAsDraft', update)
        .execute(function (err) {
          if (err) {
            return done(err);
          }

          draft = helper.getLastSubmission();
          assert.equal(draft._id, update._id);
          assert.equal(draft.state, 'draft');
          assert.equal(draft.data.firstName, 'Sarah');
          assert.equal(draft.data.email, 'sarah@example.com');
          done();
        });
    });

    it('Should PATCH a draft without requiring missing fields', function (done) {
      helper.patchSubmission(
        draft,
        [
          {
            op: 'replace',
            path: '/data/lastName',
            value: 'Lee',
          },
        ],
        function (err) {
          if (err) {
            return done(err);
          }

          draft = helper.getLastSubmission();
          assert.equal(draft.state, 'draft');
          assert.equal(draft.data.lastName, 'Lee');
          assert.equal(draft.data.firstName, 'Sarah');
          done();
        },
      );
    });

    it('Should list drafts via state=draft and owner filters', function (done) {
      const form = helper.getForm('saveAsDraft');
      request(app)
        .get(
          hook.alter(
            'url',
            `/form/${form._id}/submission?state=draft&owner=${draft.owner}&sort=-modified`,
            template,
          ),
        )
        .set('x-jwt-token', helper.owner.token)
        .expect('Content-Type', /json/)
        .expect(200)
        .end(function (err, res) {
          if (err) {
            return done(err);
          }

          assert(Array.isArray(res.body), 'Draft query must return an array');
          assert(res.body.length >= 1, 'Draft query must return the saved draft');
          assert.equal(res.body[0].state, 'draft');
          assert.equal(String(res.body[0].owner), String(draft.owner));
          assert(
            res.body.some((item) => String(item._id) === String(draft._id)),
            'Draft query must include the current draft',
          );
          done();
        });
    });

    it('Should reject promoting a draft that is still invalid', function (done) {
      const update = {
        ...draft,
        state: 'submitted',
        data: {
          ...draft.data,
          email: '',
        },
      };
      helper
        .submission('saveAsDraft', update, helper.owner, [/json/, 400])
        .execute(function (err) {
          if (err) {
            return done(err);
          }
          const body = helper.lastResponse.body;
          assert(body.name === 'ValidationError' || (body.details && body.details.length));
          done();
        });
    });

    it('Should promote a complete draft to submitted and keep the same _id', function (done) {
      const draftId = draft._id;
      const update = {
        ...draft,
        state: 'submitted',
        data: {
          firstName: 'Sarah',
          lastName: 'Lee',
          email: 'sarah@example.com',
        },
      };
      helper
        .submission('saveAsDraft', update)
        .execute(function (err) {
          if (err) {
            return done(err);
          }

          const submission = helper.getLastSubmission();
          assert.equal(submission._id, draftId);
          assert.equal(submission.state, 'submitted');
          assert.equal(submission.data.firstName, 'Sarah');
          assert.equal(submission.data.lastName, 'Lee');
          assert.equal(submission.data.email, 'sarah@example.com');
          done();
        });
    });

    it('Should allow two drafts to share a unique value', function (done) {
      helper
        .submission({
          state: 'draft',
          data: {
            firstName: 'Alex',
            email: 'shared@example.com',
          },
        })
        .execute(function (err) {
          if (err) {
            return done(err);
          }

          helper
            .submission({
              state: 'draft',
              data: {
                firstName: 'Jordan',
                email: 'shared@example.com',
              },
            })
            .execute(function (err) {
              if (err) {
                return done(err);
              }

              const submission = helper.getLastSubmission();
              assert.equal(submission.state, 'draft');
              assert.equal(submission.data.email, 'shared@example.com');
              done();
            });
        });
    });

    it('Should not send emails for draft submissions', async function () {
      this.timeout(10000);
      template.hooks.reset();

      await new Promise((resolve, reject) => {
        helper
          .form('saveAsDraftEmail', [
            {
              type: 'textfield',
              key: 'firstName',
              label: 'First Name',
              input: true,
              validate: { required: true },
            },
            {
              type: 'email',
              key: 'email',
              label: 'Email',
              input: true,
            },
          ])
          .action('saveAsDraftEmail', {
            title: 'Email',
            name: 'email',
            handler: ['after'],
            method: ['create', 'update'],
            priority: 1,
            settings: {
              transport: 'test',
              from: 'noreply@example.com',
              emails: '{{ data.email }}',
              sendEach: false,
              subject: 'Draft should not send',
              message: 'Hello {{ data.firstName }}',
            },
          })
          .execute((err) => (err ? reject(err) : resolve()));
      });

      await new Promise((resolve, reject) => {
        helper
          .submission({
            state: 'draft',
            data: {
              firstName: 'Sam',
              email: 'sam@example.com',
            },
          })
          .execute((err) => (err ? reject(err) : resolve()));
      });

      await wait(400);
      assert.equal(template.hooks.getEmails().length, 0, 'Draft save must not fire email actions');

      const existing = helper.getLastSubmission();
      existing.state = 'submitted';
      existing.data.firstName = 'Sam';
      existing.data.email = 'sam@example.com';

      const event = template.hooks.getEmitter();
      const emailPromise = event
        ? new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('Email action did not fire after submitting the draft'));
            }, 4000);
            event.once('newMail', (email) => {
              clearTimeout(timeout);
              resolve(email);
            });
          })
        : null;

      await new Promise((resolve, reject) => {
        helper
          .submission('saveAsDraftEmail', existing)
          .execute((err) => (err ? reject(err) : resolve()));
      });

      if (emailPromise) {
        const email = await emailPromise;
        assert.equal(email.subject, 'Draft should not send');
        assert.equal(email.to, 'sam@example.com');
      } else {
        await wait(400);
        const emails = template.hooks.getEmails();
        assert.equal(emails.length, 1, 'Submitting a draft must fire email actions');
        assert.equal(emails[0].subject, 'Draft should not send');
      }
    });
  });
};
