import { useCallback, useEffect, useRef, useState } from 'react';
import { Form, useFormioContext } from '@formio/react';
import { useLocation } from 'wouter';

/** Persist shortly after each change without a request per keystroke. */
const AUTOSAVE_DEBOUNCE_MS = 400;

type DraftPayload = {
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export const EnterData = ({ url }: { url: string }) => {
  const setLocation = useLocation()[1];
  const { Formio } = useFormioContext();
  const [ready, setReady] = useState(false);
  const [canSaveDraft, setCanSaveDraft] = useState(false);
  const [draftSubmission, setDraftSubmission] = useState<object | undefined>();
  const draftIdRef = useRef<string | undefined>();
  const lastDataRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const pendingRef = useRef<DraftPayload | null>(null);
  const submittedRef = useRef(false);
  const persistDraftRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const user = await Formio.currentUser();
        const userId = user && user._id;
        if (cancelled) {
          return;
        }
        if (!userId) {
          setCanSaveDraft(false);
          setReady(true);
          return;
        }
        setCanSaveDraft(true);
        try {
          const formio = new Formio(url);
          const drafts = await formio.loadSubmissions({
            params: {
              state: 'draft',
              owner: userId,
              limit: 1,
              sort: '-created',
            },
          });
          if (cancelled) {
            return;
          }
          const existing = Array.isArray(drafts) && drafts.length ? drafts[0] : null;
          if (existing?._id) {
            draftIdRef.current = existing._id;
            lastDataRef.current = JSON.stringify(existing.data || {});
            setDraftSubmission(existing);
          }
        } catch {
          // The form still works if draft restore fails.
        }
        if (!cancelled) {
          setReady(true);
        }
      } catch {
        if (!cancelled) {
          setCanSaveDraft(false);
          setReady(true);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [Formio, url]);

  const persistDraft = useCallback(async () => {
    if (submittedRef.current || savingRef.current || !canSaveDraft) {
      return;
    }
    const pending = pendingRef.current;
    if (!pending) {
      return;
    }
    pendingRef.current = null;
    savingRef.current = true;
    try {
      const formio = new Formio(url);
      const saved = await formio.saveSubmission({
        data: pending.data,
        metadata: pending.metadata,
        state: 'draft',
        ...(draftIdRef.current ? { _id: draftIdRef.current } : {}),
      });
      if (saved?._id) {
        draftIdRef.current = saved._id;
      }
    } catch (err) {
      console.warn('Draft auto-save failed', err);
    } finally {
      savingRef.current = false;
      if (pendingRef.current && !submittedRef.current) {
        void persistDraftRef.current();
      }
    }
  }, [Formio, canSaveDraft, url]);

  persistDraftRef.current = persistDraft;

  const onChange = useCallback(
    (
      submission: { data?: Record<string, unknown>; metadata?: Record<string, unknown> },
      _flags?: unknown,
      modified?: boolean,
    ) => {
      if (submittedRef.current || !canSaveDraft || !submission?.data) {
        return;
      }
      const serialized = JSON.stringify(submission.data);
      if (serialized === lastDataRef.current) {
        return;
      }
      // Skip the initial empty/restored change event so we do not POST an unchanged draft.
      if (modified === false && lastDataRef.current === '') {
        lastDataRef.current = serialized;
        return;
      }
      lastDataRef.current = serialized;
      pendingRef.current = { data: submission.data, metadata: submission.metadata };
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        void persistDraftRef.current();
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [canSaveDraft],
  );

  const onSubmitDone = useCallback(() => {
    submittedRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    pendingRef.current = null;
    setLocation('/view');
  }, [setLocation]);

  if (!ready) {
    return <div className="panel enter-data active" />;
  }

  return (
    <div className="panel enter-data active">
      <Form
        src={url}
        {...(draftSubmission ? { submission: draftSubmission } : {})}
        onChange={onChange}
        onSubmitDone={onSubmitDone}
      />
    </div>
  );
};
