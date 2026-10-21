// Desorting (Codeforces, rating 800)
// https://codeforces.com/problemset/problem/1853/A
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
        vector<int> vec(n);

        for(int i=0;i<n;i++){
            cin >> vec[i];
        }

        int mindiff=*max_element(vec.begin(), vec.end());
        bool unsorted=false;
        for(int i=0;i<n-1;i++){
            if(vec[i+1]>=vec[i]){
                if(mindiff > (vec[i+1]-vec[i])){
                    mindiff = (vec[i+1]-vec[i]);
                }

            }   
            else{
                unsorted=true;
                break;
            }
        }

        if(unsorted){
            cout << 0 << endl;
            continue;
        }

        cout << floor(mindiff/2)+1 << endl;

    }

    return 0;
}
