// Everybody Likes Good Arrays! (Codeforces, rating 800)
// https://codeforces.com/problemset/problem/1777/A
// Accepted 21/10/2026

#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int t;
    cin >> t;

    while(t--){

        int n;
        cin >> n;

        vector<int > vec(n);
        for(int i=0;i<n;i++) cin >> vec[i];

        if(n == 1){
            cout << 0 << endl;
            continue;
        }

        int count=0;

         for(int i=0;i<n-1;i++){
            int sum=vec[i]+vec[i+1];
            if(sum%2==0){
                count++;
            }
        }

        cout << count << endl;
    }


    return 0;
}
